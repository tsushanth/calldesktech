// Bulk import for the readaloud lead sources (ids ra-*). A sibling of
// pipeline.ts's bulkImportRegistry rather than an entry in
// BULK_REGISTRY_SOURCES, because these are not registries: they carry no
// licence/phone/city (RegistryMeta), must not go through registryLeadRow's
// international hold (readaloud's existing stages apply only the DACH block,
// and an API sold to developers worldwide is not a local-business registry),
// and some of them (the jobs signal) ENRICH existing leads instead of adding
// new ones. It writes through the same table helpers, so rows land in
// leadsTable(readaloud) tagged product='readaloud' like every readaloud lead.
//
// Idempotent and safe to re-run:
//   * dedupe on source_key AND domain (the table is unique per product+domain),
//     within the batch and against existing readaloud leads
//   * a company that is already a lead gets this source's facts MERGED into
//     signals.readaloud.sources[<source id>] (replacing that source's previous
//     facts, so re-runs never stack score bumps)
//   * suppressed role addresses are never attached; a lead whose only published
//     contact is suppressed is skipped
// New leads keep contact_status 'unknown' (enriched_at null) and are picked up
// by the daily run's stageEnrich, which finds the website's contact email.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isBlockedDomain, isRegionBlocked, scoreLead } from '../score';
import { leadsTable, suppressionsTable, scopeToProduct, productInsertFields, readaloud, type ProductConfig } from '../../products';
import { PoliteHttp, RA_SOURCE_IDS, type RaHttp, type RaLead, type RaLoadResult, type RaSourceId, type RaSourceFacts } from './common';
import { loadCompetitorCustomers } from './competitorCustomers';
import { loadYcVoice } from './ycVoice';
import { loadGithubOrgs } from './githubOrgs';
import { loadJobsSignal, type Company } from './jobsSignal';
import { loadWpPlugins, loadFirefoxTts } from './marketplaces';
import { loadHnLaunches } from './hnLaunches';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export interface ExistingLead {
  id: string;
  company_name: string;
  domain: string | null;
  source_key: string | null;
  contact_email: string | null;
  score: number | null;
  status?: string | null;
  signals: ({ readaloud?: { sources?: Record<string, RaSourceFacts> } } & Record<string, unknown>) | null;
}

export interface LoadContext {
  http: RaHttp;
  log: (m: string) => void;
  existing: ExistingLead[];
  env: NodeJS.ProcessEnv;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const RA_SOURCES: Record<RaSourceId, { what: string; load: (ctx: LoadContext) => Promise<RaLoadResult> }> = {
  'ra-cartesia-customers': { what: 'Cartesia customer case studies', load: (c) => loadCompetitorCustomers('cartesia', c.http, { log: c.log }) },
  'ra-deepgram-customers': { what: 'Deepgram customer case studies', load: (c) => loadCompetitorCustomers('deepgram', c.http, { log: c.log }) },
  'ra-yc-voice': { what: 'Y Combinator voice/speech companies', load: (c) => loadYcVoice(c.http) },
  'ra-github-orgs': {
    what: 'GitHub organisations with speech/voice code, topics or location',
    load: (c) => loadGithubOrgs(c.http, {
      log: c.log, codePages: num(c.env.RA_GITHUB_CODE_PAGES, 3), searchPages: num(c.env.RA_GITHUB_SEARCH_PAGES, 2), maxOrgs: num(c.env.RA_GITHUB_MAX_ORGS, 400),
      parts: c.env.RA_GITHUB_PARTS ? (c.env.RA_GITHUB_PARTS.split(',').map((s) => s.trim()) as ('code' | 'orgs' | 'topics')[]) : undefined,
    }),
  },
  'ra-jobs-signal': {
    what: 'voice/speech job openings (Greenhouse/Lever/Ashby + HN Who is hiring)',
    load: async (c) => {
      // Companies to probe: every readaloud lead with a website, plus (opt-in, or
      // by default when there is no DB to read them from) the cheap sources.
      const companies: Company[] = c.existing.filter((l) => l.domain && l.status !== 'dead').map((l) => ({ name: l.company_name, domain: (l.domain as string).toLowerCase() }));
      const include = (c.env.RA_JOBS_INCLUDE ?? (c.existing.length ? '' : 'ra-cartesia-customers,ra-deepgram-customers,ra-yc-voice')).split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of include) {
        if (!(id in RA_SOURCES) || id === 'ra-jobs-signal') continue;
        const r = await RA_SOURCES[id as RaSourceId].load(c);
        companies.push(...r.leads.map((l) => ({ name: l.name, domain: l.domain })));
        c.log(`jobs: +${r.leads.length} companies from ${id}`);
      }
      return loadJobsSignal(c.http, companies, { log: c.log, hnMonths: num(c.env.RA_JOBS_HN_MONTHS, 3), maxCompanies: num(c.env.RA_JOBS_MAX_COMPANIES, 400) });
    },
  },
  'ra-wp-plugins': { what: 'WordPress text-to-speech plugin publishers (>=1000 installs)', load: (c) => loadWpPlugins(c.http) },
  'ra-firefox-tts': { what: 'Firefox text-to-speech add-on publishers (>=5000 daily users)', load: (c) => loadFirefoxTts(c.http) },
  'ra-hn-launches': { what: 'Hacker News voice/speech product launches', load: (c) => loadHnLaunches(c.http) },
};

export function isRaSource(id: string): id is RaSourceId {
  return (RA_SOURCE_IDS as readonly string[]).includes(id);
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const sameFacts = (a: RaSourceFacts | undefined, b: RaSourceFacts) => !!a && JSON.stringify(a) === JSON.stringify(b);

export function sumReadaloudAdjust(signals: ExistingLead['signals']): { adjust: number; reasons: string[] } {
  const sources = signals?.readaloud?.sources ?? {};
  let adjust = 0;
  const reasons: string[] = [];
  for (const s of Object.values(sources)) { adjust += s.adjust; reasons.push(...s.reasons); }
  return { adjust, reasons };
}

// The row for a NEW lead. Pure (exported for tests).
export function readaloudLeadRow(l: RaLead, product: ProductConfig, now: string) {
  const base = scoreLead({ tier: null, location: l.location, description: l.description }, undefined, product);
  const blocked = isRegionBlocked(l.location, l.name) || isBlockedDomain(l.domain);
  return {
    company_name: l.name, domain: l.domain, source_key: l.sourceKey, tier: null, location: l.location, description: l.description,
    score: clamp(base.score + l.source.adjust), region_blocked: blocked,
    signals: { reasons: [...base.reasons, ...l.source.reasons], techPlatforms: [] as string[], readaloud: { sources: { [l.sourceId]: l.source } } },
    ...(l.email ? { contact_email: l.email, contact_status: 'found', contact_source_url: l.emailSourceUrl, enriched_at: now } : {}),
    signal_source: l.signalSource, signal_detail: l.signalDetail.slice(0, 300), last_seen_at: now, ...productInsertFields(product),
  };
}

export interface ImportPlan {
  inserts: ReturnType<typeof readaloudLeadRow>[];
  merges: { id: string; name: string; patch: { signals: Record<string, unknown>; score: number; last_seen_at: string } }[];
  skipped: Record<string, number>;
}

// Decide what to insert / merge / skip. Pure: no DB, no network.
export function planReadaloudImport(
  leads: RaLead[], existing: ExistingLead[], suppressed: Set<string>, product: ProductConfig = readaloud, now = new Date().toISOString(),
): ImportPlan {
  const plan: ImportPlan = { inserts: [], merges: [], skipped: {} };
  const skip = (r: string) => { plan.skipped[r] = (plan.skipped[r] ?? 0) + 1; };
  const byKey = new Map<string, ExistingLead>();
  const byDomain = new Map<string, ExistingLead>();
  const knownEmails = new Set<string>();
  for (const e of existing) {
    if (e.source_key) byKey.set(e.source_key, e);
    if (e.domain) byDomain.set(e.domain.toLowerCase(), e);
    if (e.contact_email) knownEmails.add(e.contact_email.toLowerCase());
  }
  const batchKeys = new Set<string>();
  const batchDomains = new Set<string>();
  const merged = new Set<string>();
  // Strongest evidence first, so the survivor of a same-domain pair is the best one.
  const ordered = [...leads].sort((a, b) => b.source.adjust - a.source.adjust);
  for (const l of ordered) {
    const domain = l.domain.toLowerCase();
    if (batchKeys.has(l.sourceKey)) { skip('duplicate source_key in batch'); continue; }
    batchKeys.add(l.sourceKey);
    const hit = byKey.get(l.sourceKey) ?? byDomain.get(domain);
    if (hit) {
      if (merged.has(hit.id)) { skip('duplicate domain in batch'); continue; }
      const prev = hit.signals?.readaloud?.sources?.[l.sourceId];
      if (sameFacts(prev, l.source)) { skip('already recorded on existing lead'); continue; }
      merged.add(hit.id);
      const sources = { ...(hit.signals?.readaloud?.sources ?? {}), [l.sourceId]: l.source };
      const score = clamp((hit.score ?? 50) - (prev?.adjust ?? 0) + l.source.adjust);
      plan.merges.push({
        id: hit.id, name: hit.company_name,
        patch: { signals: { ...(hit.signals ?? {}), readaloud: { ...(hit.signals?.readaloud ?? {}), sources } }, score, last_seen_at: now },
      });
      continue;
    }
    if (batchDomains.has(domain)) { skip('duplicate domain in batch'); continue; }
    if (isBlockedDomain(domain)) { skip('blocked domain (DE/AT/CH/LI)'); continue; }
    let lead = l;
    if (l.email) {
      const e = l.email.toLowerCase();
      if (suppressed.has(e)) { skip('published contact is suppressed'); continue; }
      if (knownEmails.has(e)) lead = { ...l, email: null, emailSourceUrl: null };
      else knownEmails.add(e);
    }
    batchDomains.add(domain);
    plan.inserts.push(readaloudLeadRow(lead, product, now));
  }
  return plan;
}

export interface ImportSummary {
  source: RaSourceId;
  dryRun: boolean;
  scanned: number;
  rows: number; // leads the source produced
  companies: number; // distinct domains among them
  withWebsite: number;
  withEmail: number;
  toInsert: number;
  toMerge: number;
  inserted: number;
  merged: number;
  rejected: Record<string, number>;
  skipped: Record<string, number>;
  notes: string[];
  errors: string[];
  sample: { name: string; domain: string; score: number; email: string | null }[];
}

async function selectAll<T>(build: () => { order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } }): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// db === null: no database at all (local dry run): dedupe happens only within the batch.
export async function importReadaloudSource(
  db: Db | null, sourceId: string,
  opts: { dryRun?: boolean; log?: (m: string) => void; http?: RaHttp; env?: NodeJS.ProcessEnv; product?: ProductConfig } = {},
): Promise<ImportSummary> {
  if (!isRaSource(sourceId)) throw new Error(`unknown readaloud source "${sourceId}" (have: ${RA_SOURCE_IDS.join(', ')})`);
  const product = opts.product ?? readaloud;
  if (product.id !== 'readaloud') throw new Error(`readaloud sources are for PRODUCT=readaloud, not ${product.id}`);
  const dryRun = !!opts.dryRun || !db;
  const log = opts.log ?? (() => {});
  const http = opts.http ?? new PoliteHttp({ log });

  let existing: ExistingLead[] = [];
  const suppressed = new Set<string>();
  if (db) {
    existing = await selectAll<ExistingLead>(() => scopeToProduct(db.from(leadsTable(product)).select('id, company_name, domain, source_key, contact_email, score, status, signals'), product));
    const sup = await selectAll<{ email: string }>(() => db.from(suppressionsTable(product)).select('id, email'));
    for (const s of sup) suppressed.add(String(s.email).toLowerCase());
    log(`existing readaloud leads: ${existing.length}, suppressed: ${suppressed.size}`);
  } else {
    log('no database: dedupe within this batch only');
  }

  const res = await RA_SOURCES[sourceId].load({ http, log, existing, env: opts.env ?? process.env });
  const plan = planReadaloudImport(res.leads, existing, suppressed, product);
  const summary: ImportSummary = {
    source: sourceId, dryRun, scanned: res.scanned, rows: res.leads.length,
    companies: new Set(res.leads.map((l) => l.domain)).size,
    withWebsite: res.leads.filter((l) => !!l.domain).length,
    withEmail: res.leads.filter((l) => !!l.email).length,
    toInsert: plan.inserts.length, toMerge: plan.merges.length, inserted: 0, merged: 0,
    rejected: res.rejected, skipped: plan.skipped, notes: res.notes, errors: [...res.errors],
    sample: plan.inserts.slice().sort((a, b) => b.score - a.score).slice(0, 8).map((r) => ({ name: r.company_name, domain: r.domain, score: r.score, email: (r as { contact_email?: string }).contact_email ?? null })),
  };
  if (dryRun || !db) return summary;

  for (let i = 0; i < plan.inserts.length; i += 200) {
    const chunk = plan.inserts.slice(i, i + 200);
    const { error } = await db.from(leadsTable(product)).insert(chunk);
    if (!error) { summary.inserted += chunk.length; continue; }
    for (const row of chunk) {
      const { error: e1 } = await db.from(leadsTable(product)).insert(row);
      if (e1) summary.errors.push(`insert ${row.company_name}: ${e1.message}`); else summary.inserted++;
    }
  }
  for (const m of plan.merges) {
    const { error } = await db.from(leadsTable(product)).update(m.patch).eq('id', m.id);
    if (error) summary.errors.push(`merge ${m.name}: ${error.message}`); else summary.merged++;
  }
  log(`inserted ${summary.inserted}/${plan.inserts.length}, merged ${summary.merged}/${plan.merges.length}`);
  summary.errors = summary.errors.slice(0, 30);
  return summary;
}
