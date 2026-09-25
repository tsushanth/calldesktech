import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { adminEmails } from '../config';
import { draftAgencyEmail, draftFollowUpEmail } from '../agencyDraft';
import { fetchDirectory } from './retellDirectory';
import { findAgencyDomain } from './findDomain';
import { findContact, type ContactForm } from './contactPages';
import { isBlockedDomain, isRegionBlocked, scoreLead, type ScoreEvidence } from './score';
import { findJobPostingCandidates } from './jobPostingsSearch';
import { findReviewSiteCandidates } from './reviewSitesSearch';
import { findGithubCandidates } from './githubSignal';
import { findTelephonyPlatformCandidates } from './telephonyPlatformsSearch';
import { findSttTtsSignalCandidates } from './sttTtsSignalSearch';
import { checkDomainForPlatforms } from '../signals/techFingerprint';
import { LeadIndex } from './dedupe';
import { researchAgency, type Dossier } from '../research';
import { findSearchCandidates, queriesForDay } from './searchSource';
import { findFreightBrokerCandidates, describeBroker, isFreeMail } from './freightFmcsa';
import { findVerticalSearchCandidates, type SearchVertical } from './verticalSearch';
import { findTowingCandidates } from './towingWa';
import { findSepticCandidates } from './septicRegistry';
import { findFlDfsCandidates } from './flDfsRegistry';
import { findHomeservicesCandidates, findHomecareRegistryCandidates, findTxCandidatesForSlot } from './registryRotation';
import { allNycDobLeads } from './nycDobLicenses';
import { allVaDporLeads } from './vaDporContractors';
import { streamArContractorLeads } from './arkansasContractors';
import { streamCaCdphLeads } from './homecareCaCdph';
import { allRgeLeads } from './frRgeRegistry';
import { allCqcLeads } from './ukCqcDirectory';
import { allDvsaLeads } from './ukDvsaOperators';
import { allBrregLeads } from './noBrregEnheter';
import { allFrFuneralLeads } from './frFuneralOperators';
import { allQcCpeLeads } from './qcChildcare';
import { allQcLodgingLeads } from './qcLodging';
import { allSgEcdaLeads } from './sgEcdaChildcare';
import { allEeAgencyLeads } from './eeAriregister';

import { allBrCnpjLeads, BR_PRODUCT_IDS } from './brCnpjRegistry';
import { allDenueLeads, MX_PRODUCT_IDS } from './mxDenueRegistry';
import { findDentalNppesCandidates } from './dentalNppes';
import { allChildcareLeads, findChildcareCandidates } from './childcareUs';
import { discoverWebsite } from './websiteDiscovery';
import { INTL_HOLD_REASON, intlCountry, type IntlHold, type RegistryLead, type RegistryResult } from './registryCommon';
import { calldesk, leadsTable, runsTable, messagesTable, suppressionsTable, scopeToProduct, productInsertFields, type ProductConfig } from '../products';
import type { FormOutreachStatus, FormAttempt } from '../formSubmit';

// The daily discovery harness. One call = one full pass:
//   directory -> dedupe against existing leads -> enrich (domain, contact)
//   -> score -> draft for new qualified leads -> record the run.
// Every stage is idempotent, so a rerun or a timeout never duplicates work:
//   * leads are matched by source_key, then normalized name, then domain
//   * a lead is enriched once (enriched_at), re-checked only after 30 days
//   * a lead gets at most one live message (unique index + in-code check)
// dryRun performs real reads and fetches but writes nothing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export interface RunOptions {
  dryRun?: boolean;
  enrichLimit?: number;
  draftLimit?: number;
  researchLimit?: number;
  // Kill switch: polled between stages and inside loops; when true the run winds down cleanly.
  shouldStop?: () => boolean;
  // Selects table names, offer facts/prompts/signature, and scoring vocabulary
  // (see ../products.ts). Defaults to calldesk, so every existing caller that
  // doesn't pass this keeps its exact prior behavior.
  product?: ProductConfig;
}

export interface RunSummary {
  runId: string | null;
  dryRun: boolean;
  status: 'ok' | 'error';
  directoryCount: number;
  searchCandidates: number;
  jobPostingCandidates: number;
  reviewSiteCandidates: number;
  githubCandidates: number;
  techFingerprintHits: number;
  searchDebug: { raw: number; rejected: string[] } | null;
  stopped: boolean;
  leadsSeen: number;
  leadsNew: number;
  duplicatesSkipped: number;
  contactsFound: number;
  draftsCreated: number;
  formDrafts?: number;
  followUpsCreated: number;
  researched: number;
  lowFit: number;
  errors: string[];
  sample: {
    enriched: { name: string; domain: string | null; email: string | null; status: string }[];
    researched: { name: string; fit: string; hook: string | null; sources: number }[];
  };
}

const MIN_DRAFT_SCORE = 40;
const RECHECK_DAYS = 30;

// The drafted message and its lifecycle, kept on the lead. Statuses beyond
// 'ready' are driven by the human ("Submit for me" -> 'queued') and by the
// form-submission worker ('submitting' -> 'submitted' | 'needs_manual' |
// 'failed'). See src/lib/outreach/formSubmit.ts for the transition rules.
export interface FormOutreach {
  subject: string;
  body: string;
  status: FormOutreachStatus;
  draftedAt: string;
  submittedAt?: string;
  /** Set with 'needs_manual': why a human has to finish this one. */
  reason?: string;
  /** Set with 'failed': the error the worker hit. */
  error?: string;
  /** Who queued it and when, for the audit trail. */
  queuedAt?: string;
  queuedBy?: string;
  /** Every worker attempt, newest last. */
  attempts?: FormAttempt[];
}

interface LeadRow {
  id: string;
  company_name: string;
  domain: string | null;
  source_key: string | null;
  status: string;
  contact_email: string | null;
  contact_status: string | null;
  region_blocked: boolean | null;
  tier: string | null;
  location: string | null;
  description: string | null;
  score: number | null;
  enriched_at: string | null;
  research?: Dossier | null;
  signals: { reasons: string[]; techPlatforms: string[]; registry?: RegistryMeta; intlHold?: IntlHold; contactForm?: ContactForm; formOutreach?: FormOutreach } | null;
}

// Registry facts kept on the lead's `signals` (never put in the draft-visible
// description): the registry phone so a human can call unresolved leads, plus
// the identity used for website lookup and the score adjustment to re-apply on rescoring.
interface RegistryMeta {
  phone: string | null; licenseId: string; registry: string; typeLabel: string; legalName: string | null;
  city: string | null; state: string | null; contactName: string | null; adjust: number; reasons: string[];
}

// Customer-discovery products whose leads come from a public REGISTRY that has no
// email: stageRegistry ingests them, stageEnrich resolves website -> published email.
const REGISTRY_PRODUCTS = new Set(['towing', 'septic', 'homecare', 'homeservices', 'dental', 'insurance', 'bailbonds', 'childcare']);
const REGISTRY_KIND: Record<string, string> = {
  towing: 'towing company (tow truck operator)',
  septic: 'septic tank service / liquid waste hauling company',
  homecare: 'home care agency',
  freight: 'road freight haulage company',
  childcare: 'child care centre / daycare / preschool',
};

export async function runDiscovery(db: Db, opts: RunOptions = {}): Promise<RunSummary> {
  const product = opts.product ?? calldesk;
  const dryRun = !!opts.dryRun;
  const enrichLimit = opts.enrichLimit ?? 25;
  const draftLimit = opts.draftLimit ?? 10;
  const stop = () => {
    if (opts.shouldStop?.()) summary.stopped = true;
    return summary.stopped;
  };

  const summary: RunSummary = {
    runId: null, dryRun, status: 'ok', directoryCount: 0, searchCandidates: 0,
    jobPostingCandidates: 0, reviewSiteCandidates: 0, githubCandidates: 0, techFingerprintHits: 0,
    searchDebug: null, stopped: false, leadsSeen: 0, leadsNew: 0,
    duplicatesSkipped: 0, contactsFound: 0, draftsCreated: 0, followUpsCreated: 0, researched: 0, lowFit: 0, errors: [], sample: { enriched: [], researched: [] },
  };

  if (!dryRun) {
    const { data } = await db.from(runsTable(product)).insert({ dry_run: false, ...productInsertFields(product) }).select('id').single();
    summary.runId = data?.id ?? null;
  }

  try {
    const { entries, index } = await stageDirectory(db, summary, dryRun, product);
    const searchEntries = stop() ? [] : await stageSearch(db, summary, dryRun, index, stop, product);
    const jobPostingEntries = stop() ? [] : await stageJobPostings(db, summary, dryRun, index, stop, product);
    const reviewSiteEntries = stop() ? [] : await stageReviewSites(db, summary, dryRun, index, stop, product);
    const githubEntries = stop() ? [] : await stageGithub(db, summary, dryRun, index, stop, product);
    const telephonyEntries = stop() ? [] : await stageTelephonyPlatforms(db, summary, dryRun, index, stop, product);
    const sttTtsEntries = stop() ? [] : await stageSttTtsSignal(db, summary, dryRun, index, stop, product);
    const freightEntries = stop() ? [] : await stageFreight(db, summary, dryRun, index, stop, product);
    const verticalEntries = stop() ? [] : await stageVerticalSearch(db, summary, dryRun, index, stop, product);
    const registryEntries = stop() ? [] : await stageRegistry(db, summary, dryRun, index, stop, product);
    const allEntries = [
      ...entries, ...searchEntries, ...jobPostingEntries, ...reviewSiteEntries, ...githubEntries,
      ...telephonyEntries, ...sttTtsEntries, ...freightEntries, ...verticalEntries, ...registryEntries,
    ];
    if (!stop()) await stageEnrich(db, summary, dryRun, enrichLimit, allEntries, index, stop, product);
    // The research stage judges "is this an AI voice agency"; it is agency-specific,
    // so it never runs for the customer-discovery verticals (drafting then does not
    // require a dossier either, since researchOn also gates that).
    const researchOn = process.env.OUTREACH_RESEARCH === '1' && !product.vertical;
    if (researchOn && !stop()) await stageResearch(db, summary, dryRun, opts.researchLimit ?? 5, stop, product);
    if (!stop()) await stageDraft(db, summary, dryRun, draftLimit, stop, researchOn, product);
    if (!stop() && product.vertical) await stageFormDrafts(db, summary, dryRun, draftLimit, stop, product);
    if (!stop()) await stageFollowUp(db, summary, dryRun, stop, product);
  } catch (error) {
    summary.status = 'error';
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }

  if (!dryRun) {
    if (summary.runId) {
      await db.from(runsTable(product)).update({
        finished_at: new Date().toISOString(),
        status: summary.status,
        leads_seen: summary.leadsSeen,
        leads_new: summary.leadsNew,
        contacts_found: summary.contactsFound,
        drafts_created: summary.draftsCreated,
        errors: summary.errors.slice(0, 50),
      }).eq('id', summary.runId);
    }
    await notify(db, summary, product);
  }
  return summary;
}

interface DirectoryEntry {
  row: LeadRow;
  slug: string | null;
}

// PostgREST caps a plain select at 1000 rows, which silently truncates dedupe indexes once a
// product holds more leads than that (the bulk-imported insurance list is ~44k). Page through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function selectAll<T>(build: () => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function stageDirectory(
  db: Db, summary: RunSummary, dryRun: boolean, product: ProductConfig,
): Promise<{ entries: DirectoryEntry[]; index: LeadIndex<LeadRow> }> {
  const existing = await selectAll<LeadRow>(() => scopeToProduct(db.from(leadsTable(product)).select('*'), product));
  const index = new LeadIndex<LeadRow>(existing);

  // The Retell partner directory is calldesk-specific (calldesk competes
  // directly with agencies on Retell's directory); readaloud has no
  // equivalent directory source, but the index above (existing leads for
  // this product) is still needed by every later dedupe stage.
  if (product.id !== 'calldesk') return { entries: [], index };

  const partners = await fetchDirectory();
  const entries: DirectoryEntry[] = [];
  const handled = new Set<string>();
  summary.directoryCount = partners.length;
  const now = new Date().toISOString();

  for (const p of partners) {
    const sourceKey = `retell:${p.slug}`;
    const { score, reasons } = scoreLead({ tier: p.tier, location: p.location, description: p.description }, undefined, product);
    const blocked = isRegionBlocked(p.location, p.name);
    const match = index.find({ sourceKey, name: p.name });

    if (match) {
      // Two directory listings can map to one lead (e.g. a company listed twice): handle it once.
      if (handled.has(match.id)) continue;
      handled.add(match.id);
      summary.leadsSeen++;
      entries.push({
        slug: p.slug,
        row: { ...match, source_key: match.source_key ?? sourceKey, tier: p.tier, location: p.location, description: p.description, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] } },
      });
      if (dryRun) continue;
      const { error } = await db.from(leadsTable(product)).update({
        source_key: match.source_key ?? sourceKey,
        tier: p.tier, location: p.location, description: p.description,
        score, region_blocked: blocked, signals: { reasons, techPlatforms: [] }, last_seen_at: now,
      }).eq('id', match.id);
      if (error) summary.errors.push(`update ${p.name}: ${error.message}`);
      continue;
    }

    summary.leadsNew++;
    if (dryRun) {
      const fake = {
        id: `dry-${p.slug}`, company_name: p.name, domain: null, source_key: sourceKey, status: 'new', contact_email: null,
        contact_status: 'unknown', region_blocked: blocked, tier: p.tier, location: p.location, description: p.description, score, enriched_at: null,
        signals: { reasons, techPlatforms: [] },
      } as LeadRow;
      index.add(fake);
      entries.push({ slug: p.slug, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      company_name: p.name,
      signal_source: 'directory',
      signal_detail: `Retell ${p.tier ?? 'partner'}: ${(p.description ?? '').slice(0, 200)}`,
      source_key: sourceKey, tier: p.tier, location: p.location, description: p.description,
      score, region_blocked: blocked, signals: { reasons, techPlatforms: [] }, last_seen_at: now,
      ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${p.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: p.slug, row: inserted as LeadRow });
    }
  }
  return { entries, index };
}

// Second source: rotating web searches for agencies on any platform. Every
// candidate is website-verified inside findSearchCandidates before it gets here.
async function stageSearch(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  // This generic agency-search source is calldesk-specific (agencies that
  // build/sell AI voice agents); readaloud's equivalents are
  // telephonyPlatformsSearch.ts / sttTtsSignalSearch.ts below.
  if (product.id !== 'calldesk') return [];
  if (process.env.OUTREACH_SEARCH_ENABLED === 'false') return [];
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_SEARCH_QUERIES_PER_DAY ?? 3)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findSearchCandidates(queriesForDay(new Date(), perDay), stop);
  summary.errors.push(...errors);
  summary.searchDebug = { raw, rejected: rejected.slice(0, 10) };
  summary.searchCandidates = candidates.length;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `search:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue; // already known: never re-add

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, { viaReviewSite: false }, product);
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...base, signal_source: 'search', signal_detail: `Web search: ${(c.blurb ?? '').slice(0, 200)}`, last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// Job-postings signal: agencies publicly hiring for a voice-AI role. Off by
// default (OUTREACH_JOBPOSTINGS_QUERIES_PER_DAY=0) until manually enabled.
async function stageJobPostings(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  // Calldesk-specific: "hiring a voice-AI engineer" is an agency-reseller
  // signal, not a readaloud ICP signal.
  if (product.id !== 'calldesk') return [];
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_JOBPOSTINGS_QUERIES_PER_DAY ?? 0)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findJobPostingCandidates(perDay, stop);
  summary.errors.push(...errors);
  summary.jobPostingCandidates = candidates.length;
  if (rejected.length) summary.errors.push(`[job_posting] rejected as non-media/non-voice-AI: ${rejected.slice(0, 5).join(', ')}`);
  void raw;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `job_posting:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, { viaJobPosting: true }, product);
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...base, signal_source: 'job_posting', signal_detail: `Job posting: ${(c.blurb ?? '').slice(0, 200)}`, last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// Review-site signal: agencies named in public G2/Capterra/Clutch reviews as
// voice-AI providers. See reviewSitesSearch.ts for the compliance note (this
// stage's candidate blurbs are always generic labels, never review text).
// Fixed, hardcoded generic label used as `description` for every review-site
// lead. `description` reaches agencyDraft.ts's prompt as "their own
// description of what they do" — it must never carry review-site blurb text
// (which came from someone else's review of the company, not the company's
// own words). c.blurb is still used for signal_detail below (admin-facing log
// only, never fed to the drafting prompt).
const REVIEW_SITE_DESCRIPTION = 'Named in a public review as a voice-AI provider.';

async function stageReviewSites(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  // Calldesk-specific: G2/Capterra/Clutch reviews naming a voice-AI agency.
  if (product.id !== 'calldesk') return [];
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_REVIEWSITES_QUERIES_PER_DAY ?? 0)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findReviewSiteCandidates(perDay, stop);
  summary.errors.push(...errors);
  summary.reviewSiteCandidates = candidates.length;
  if (rejected.length) summary.errors.push(`[review_site] rejected: ${rejected.slice(0, 5).join(', ')}`);
  void raw;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `review_site:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, { viaReviewSite: true }, product);
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: REVIEW_SITE_DESCRIPTION, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...base, signal_source: 'review_site', signal_detail: (c.blurb ?? REVIEW_SITE_DESCRIPTION).slice(0, 200), last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// GitHub/dev signal: agencies with a public GitHub presence integrating a
// voice-AI SDK for clients. Reuses signal_source='search' (no dedicated DB
// value; see githubSignal.ts).
async function stageGithub(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  // Calldesk-specific: agencies integrating Vapi/Retell/Bland for clients.
  if (product.id !== 'calldesk') return [];
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_GITHUB_QUERIES_PER_DAY ?? 0)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findGithubCandidates(perDay, stop);
  summary.errors.push(...errors);
  summary.githubCandidates = candidates.length;
  if (rejected.length) summary.errors.push(`[github] rejected: ${rejected.slice(0, 5).join(', ')}`);
  void raw;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `github:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, undefined, product);
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...base, signal_source: 'search', signal_detail: `GitHub/dev signal: ${(c.blurb ?? '').slice(0, 190)}`, last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// readaloud discovery, Segment A: AI telephony/voice-agent platforms (Retell,
// Bland, Vapi, Synthflow, smaller/regional competitors) currently paying
// Deepgram/ElevenLabs/Cartesia for STT/TTS. Only active for readaloud.
async function stageTelephonyPlatforms(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  if (product.id !== 'readaloud') return [];
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_TELEPHONY_QUERIES_PER_DAY ?? 2)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findTelephonyPlatformCandidates(perDay, stop);
  summary.errors.push(...errors);
  summary.searchCandidates += candidates.length;
  if (rejected.length) summary.errors.push(`[telephony_platform] rejected: ${rejected.slice(0, 5).join(', ')}`);
  void raw;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `telephony_platform:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, undefined, product);
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...base, signal_source: 'search', signal_detail: `Telephony platform signal: ${(c.blurb ?? '').slice(0, 180)}`, last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// readaloud discovery, Segment B: broader realtime voice builders outside
// telephony (voice agents, dubbing/localization, accessibility, IVR
// replacement, e-learning narration). Only active for readaloud.
async function stageSttTtsSignal(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  if (product.id !== 'readaloud') return [];
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_STTTTS_QUERIES_PER_DAY ?? 2)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findSttTtsSignalCandidates(perDay, stop);
  summary.errors.push(...errors);
  summary.searchCandidates += candidates.length;
  if (rejected.length) summary.errors.push(`[stt_tts_signal] rejected: ${rejected.slice(0, 5).join(', ')}`);
  void raw;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `stt_tts_signal:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: c.blurb }, undefined, product);
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...base, signal_source: 'search', signal_detail: `STT/TTS builder signal: ${(c.blurb ?? '').slice(0, 180)}`, last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// customer-discovery vertical `freight`: active property BROKERS from FMCSA's
// free open data (see freightFmcsa.ts). The registry record already carries a
// published business email, so contact-finding is skipped: leads are inserted
// contact_status 'found' and pre-enriched. Still deduped by MC source_key, name,
// email and domain, and checked against the suppression list before insert.
async function stageFreight(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  if (product.id !== 'freight') return [];
  const rawMax = Number(process.env.OUTREACH_FREIGHT_MAX_PER_RUN);
  const max = Math.min(60, Math.max(1, Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 30));

  const { candidates, errors, scanned, rejected } = await findFreightBrokerCandidates(max, stop);
  summary.errors.push(...errors);
  summary.searchCandidates += candidates.length;
  summary.searchDebug = { raw: scanned, rejected: Object.entries(rejected).map(([k, v]) => `${k}: ${v}`) };

  const emailRows = await selectAll<{ contact_email: string | null }>(() => scopeToProduct(db.from(leadsTable(product)).select('contact_email, id'), product));
  const knownEmails = new Set(emailRows.map((r) => (r.contact_email ?? '').toLowerCase()).filter(Boolean));
  // Suppressions are global by email (no product column), same as the send-time check in sender.ts.
  const { data: supData } = await db.from(suppressionsTable(product)).select('email');
  const suppressed = new Set(((supData ?? []) as { email: string }[]).map((s) => String(s.email).toLowerCase()));

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    if (stop()) break;
    const sourceKey = `freight:mc:${c.mc}`;
    const domain = isFreeMail(c.email) ? null : c.email.split('@')[1];
    if (index.find({ sourceKey, name: c.name, domain })) continue;
    if (knownEmails.has(c.email) || suppressed.has(c.email)) continue;

    const { location, description } = describeBroker(c);
    const base = scoreLead({ tier: null, location, description: `${c.name} ${c.dba ?? ''} ${description}` }, undefined, product);
    const score = Math.max(0, Math.min(100, base.score + c.adjust));
    const reasons = [...base.reasons, ...c.reasons];
    summary.leadsNew++;
    summary.contactsFound++;

    const fields = {
      company_name: c.name, domain, source_key: sourceKey, tier: null, location, description,
      score, region_blocked: false, signals: { reasons, techPlatforms: [] as string[] },
      contact_email: c.email, contact_status: 'found',
      contact_source_url: `https://data.transportation.gov/resource/az4n-8mr2.json?dot_number=${c.dot}`,
      enriched_at: now,
    };
    knownEmails.add(c.email);
    if (dryRun) {
      const fake = { id: `dry-${sourceKey}`, status: 'new', ...fields } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      summary.sample.enriched.push({ name: c.name, domain, email: c.email, status: 'found (FMCSA)' });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...fields, signal_source: 'directory', signal_detail: `FMCSA active broker authority MC-${c.mc} (DOT ${c.dot})`, last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.contactsFound--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// customer-discovery verticals with no free registry (homeservices, dental,
// insurance): rotating LLM web searches, each candidate verified against its own
// homepage. Contacts come from the normal enrich stage (their own site).
async function stageVerticalSearch(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  if (product.id !== 'homeservices' && product.id !== 'dental' && product.id !== 'insurance' && product.id !== 'bailbonds') return [];
  const perDay = Math.min(6, Math.max(0, Number(process.env.OUTREACH_VERTICAL_QUERIES_PER_DAY ?? 2)));
  if (!perDay) return [];

  const { candidates, errors, raw, rejected } = await findVerticalSearchCandidates(product.id as SearchVertical, perDay, stop);
  summary.errors.push(...errors);
  summary.searchDebug = { raw, rejected: rejected.slice(0, 10) };
  summary.searchCandidates += candidates.length;

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const sourceKey = `${product.id}:search:${c.domain}`;
    if (index.find({ sourceKey, name: c.name, domain: c.domain })) continue;

    const blocked = isRegionBlocked(c.location, c.name) || isBlockedDomain(c.domain);
    const { score, reasons } = scoreLead({ tier: null, location: c.location, description: `${c.name} ${c.blurb ?? ''}` }, undefined, product);
    summary.leadsNew++;

    const base = {
      company_name: c.name, domain: c.domain, source_key: sourceKey, tier: null, location: c.location,
      description: c.blurb, score, region_blocked: blocked, signals: { reasons, techPlatforms: [] },
    };
    if (dryRun) {
      const fake = { id: `dry-${c.domain}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...base } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...base, signal_source: 'search', signal_detail: `${product.vertical?.leadLabel ?? 'Vertical'} web search: ${(c.blurb ?? '').slice(0, 180)}`, last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

// customer-discovery verticals backed by a public registry. Two shapes:
//   * NO email in the registry (towing: WA DOL + Montgomery County MD, septic:
//     FL DOH + Austin + Missouri, homecare: IL IDPH + NY DOH + CMS + Missouri,
//     homeservices: WA L&I, dental: NPPES, and the Texas workers' compensation
//     subscriber file across six verticals) — contact_status stays 'unknown' and
//     stageEnrich looks for the business's own website and email.
//   * email published in the registry (insurance and bailbonds: FL DFS licensee
//     file; homeservices: NYC DOB, VA DPOR, Arkansas CLB; homecare: CA CDPH;
//     some Delaware septic rows) — the lead goes in contact_status 'found'
//     and pre-enriched, like the FMCSA freight source. In all of those, a
//     free-mail address is NOT used as the contact: it is a scoring signal only
//     and the lead falls through to website discovery.
// One lead per registry business (source_key `<vertical>:<state>:<licence>`).
// The registry phone is kept in signals.registry so unresolved leads can be
// phoned by a human later.
// Pure: the lead row (and its email/domain) for one registry candidate. Shared by the per-run
// stage and the bulk import so both build identical rows.
// Exported under an explicit name so the international-hold behaviour can be
// tested without a database.
export function registryLeadRow(c: RegistryLead, product: ProductConfig, now: string) {
  const email = c.email ?? null;
  // Keep the email's domain only when it is a real business domain; free-mail
  // addresses say nothing about who owns the site. A source that publishes the
  // business's own website (the CQC and DVSA registers do, without any email)
  // supplies it directly and it wins.
  const domain = c.domain ?? (email && !isFreeMail(email) ? email.split('@')[1] : null);
  const base = scoreLead({ tier: null, location: c.location, description: `${c.name} ${c.description}` }, undefined, product);
  const score = Math.max(0, Math.min(100, base.score + c.adjust));
  const reasons = [...base.reasons, ...c.reasons];
  const registry: RegistryMeta = {
    phone: c.phone, licenseId: c.licenseId, registry: c.registryName, typeLabel: c.typeLabel, legalName: c.legalName,
    city: c.city, state: c.state, contactName: c.contactName, adjust: c.adjust, reasons: c.reasons,
  };
  const contactFields = email
    ? { contact_email: email, contact_status: 'found', contact_source_url: c.contactSourceUrl ?? null, enriched_at: now }
    : {};
  // THE INTERNATIONAL HOLD, applied in exactly one place so no source can skip
  // it: a non-US registry lead is stored region_blocked with signals.intlHold,
  // which makes it invisible to enrichment, drafting and sending until a human
  // releases its country (harness/outreach/release-country.ts).
  const country = intlCountry(c.country);
  const intlHold: IntlHold | null = country ? { country, reason: INTL_HOLD_REASON } : null;
  const fields = {
    company_name: c.name, domain, source_key: c.sourceKey, tier: null, location: c.location, description: c.description,
    score, region_blocked: !!intlHold, signals: { reasons, techPlatforms: [] as string[], registry, ...(intlHold ? { intlHold } : {}) },
    ...contactFields,
  };
  return { email, domain, fields };
}

// The email-bearing registries that can be imported in one go, and the vertical each belongs to.
// `load` returns every candidate the source has, not a capped window.
const BULK_REGISTRY_SOURCES: Record<string, { products: string[]; load: (product: ProductConfig, isKnown: (k: string) => boolean, log: (m: string) => void) => Promise<RegistryResult> }> = {
  'fl-dfs': {
    products: ['insurance', 'bailbonds'],
    load: (product, isKnown, log) => findFlDfsCandidates(product.id as 'insurance' | 'bailbonds', Number.MAX_SAFE_INTEGER, { isKnown, log }),
  },
  'nyc-dob': { products: ['homeservices'], load: (_p, isKnown, log) => allNycDobLeads({ isKnown, log }) },
  'va-dpor': { products: ['homeservices'], load: (_p, isKnown, log) => allVaDporLeads({ isKnown, log }) },
  'ar-clb': { products: ['homeservices'], load: (_p, isKnown, log) => streamArContractorLeads({ isKnown, log }) },
  'ca-cdph': { products: ['homecare'], load: (_p, isKnown, log) => streamCaCdphLeads({ isKnown, log }) },

  // US child care licensing data. All three publish a contact email on most
  // rows, so a bulk import lands leads that are already contact_status 'found'.
  'tx-childcare': { products: ['childcare'], load: (_p, isKnown, log) => allChildcareLeads('tx', { isKnown, log }) },
  'wa-childcare': { products: ['childcare'], load: (_p, isKnown, log) => allChildcareLeads('wa', { isKnown, log }) },
  'pa-childcare': { products: ['childcare'], load: (_p, isKnown, log) => allChildcareLeads('pa', { isKnown, log }) },

  // INTERNATIONAL sources. These are deliberately bulk-import-only and are NOT in
  // the per-run rotation (registryRotation.ts): every lead they produce is stored
  // on hold and cannot be drafted or sent, so spending the daily per-run slots on
  // them would only starve the US verticals that actually convert. A human imports
  // a country once, reviews it, and releases it with release-country.ts.
  'fr-rge': { products: ['homeservices'], load: (_p, isKnown, log) => allRgeLeads({ isKnown, log }) },
  'uk-cqc': { products: ['dental', 'homecare'], load: (p, isKnown, log) => allCqcLeads(p.id as 'dental' | 'homecare', { isKnown, log }) },
  'uk-dvsa': { products: ['freight'], load: (_p, isKnown, log) => allDvsaLeads({ isKnown, log }) },
  'no-brreg': {
    // Norway covers more verticals than any other single source, because it is keyed
    // on the industry code rather than on a trade licence — and now also the AGENCY
    // audience (product `calldesk`), which is the partner pitch rather than a vertical.
    products: ['dental', 'homeservices', 'freight', 'towing', 'insurance', 'homecare', 'physio', 'taxi', 'accounting', 'vets', 'realestate', 'calldesk'],
    load: (p, isKnown, log) => allBrregLeads(p.id, { isKnown, log }),
  },

  // FRANCE, funeral operators. NOTE: this dataset's licence is "notspecified" —
  // reuse terms must be confirmed with the DGCL before France is released for the
  // funeral vertical. See frFuneralOperators.ts and harness/outreach/README.md.
  'fr-funeral': { products: ['funeral'], load: (_p, isKnown, log) => allFrFuneralLeads({ isKnown, log }) },

  // QUÉBEC (country CA, drafts in Canadian French, CC-BY 4.0 attribution recorded
  // on every lead). Held pending a CASL review as well as the ordinary hold.
  'qc-cpe': { products: ['childcare'], load: (_p, isKnown, log) => allQcCpeLeads({ isKnown, log }) },
  'qc-lodging': { products: ['lodging'], load: (_p, isKnown, log) => allQcLodgingLeads({ isKnown, log }) },
  // NOTE: the RBQ contractor licences (donneesquebec.ca 'licencesactives') were
  // investigated and deliberately NOT built. The export publishes subcategory CODES
  // with no names and no per-subcategory category, and the codes it contains do not
  // match the RBQ's published Annexe I numbering: code "7" is on 43,429 of the
  // 54,237 active contractor licences (80%), so it cannot be the roofing
  // subcategory, and if that code cannot be trusted neither can "15.5" or "16".
  // Ingesting it would have meant labelling tens of thousands of leads with a trade
  // we cannot show they hold. See harness/outreach/README.md.

  // SINGAPORE, ECDA licensed child care centres (English drafts).
  'sg-ecda': { products: ['childcare'], load: (_p, isKnown, log) => allSgEcdaLeads({ isKnown, log }) },

  // ESTONIA, the agency/partner audience from the business register (English drafts).
  'ee-agencies': { products: ['calldesk'], load: (_p, isKnown, log) => allEeAgencyLeads({ isKnown, log }) },

  // LATIN AMERICA. Both are far too big for one run, so they are WORK-UNIT
  // based and the unit is chosen by environment variable, read here rather than
  // threaded through the shared `load` signature:
  //   br-cnpj  FILE=1 (which Estabelecimentos file, 0-9), START_ROW, MAX_ROWS,
  //            SKIP_NAME_JOIN=1 to skip the Empresas legal-name pass
  //   mx-denue STATES=09,15 (INEGI state codes; default all 32)
  // See brCnpjRegistry.ts / mxDenueRegistry.ts for the per-run cost of each.
  'br-cnpj': {
    products: BR_PRODUCT_IDS,
    load: (p, isKnown, log) => allBrCnpjLeads(p.id, {
      isKnown,
      log,
      fileIndex: process.env.FILE ? Number(process.env.FILE) : undefined,
      startRow: process.env.START_ROW ? Number(process.env.START_ROW) : undefined,
      maxRows: process.env.MAX_ROWS ? Number(process.env.MAX_ROWS) : undefined,
      maxCompressedBytes: process.env.MAX_COMPRESSED_BYTES ? Number(process.env.MAX_COMPRESSED_BYTES) : undefined,
      skipNameJoin: process.env.SKIP_NAME_JOIN === '1',
    }),
  },
  'mx-denue': {
    products: MX_PRODUCT_IDS,
    load: (p, isKnown, log) => allDenueLeads(p.id, {
      isKnown,
      log,
      states: process.env.STATES ? process.env.STATES.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      maxRowsPerState: process.env.MAX_ROWS ? Number(process.env.MAX_ROWS) : undefined,
      maxCompressedBytes: process.env.MAX_COMPRESSED_BYTES ? Number(process.env.MAX_COMPRESSED_BYTES) : undefined,
    }),
  },
};

export const BULK_REGISTRY_SOURCE_IDS = Object.keys(BULK_REGISTRY_SOURCES);

export function bulkRegistrySourcesFor(product: ProductConfig): string[] {
  return BULK_REGISTRY_SOURCE_IDS.filter((id) => BULK_REGISTRY_SOURCES[id].products.includes(product.id));
}

// One-off bulk import of a whole email-bearing registry instead of the daily capped window.
// Skips known licences/emails/suppressed addresses, dedupes inside the batch, and inserts in
// chunks. Idempotent: re-running only adds licensees that are not already leads.
export async function bulkImportRegistry(
  db: Db, product: ProductConfig, sourceId: string, opts: { dryRun?: boolean; log?: (m: string) => void } = {},
): Promise<{ scanned: number; candidates: number; inserted: number; skipped: Record<string, number>; errors: string[] }> {
  const source = BULK_REGISTRY_SOURCES[sourceId];
  if (!source) throw new Error(`unknown bulk import source "${sourceId}" (have: ${BULK_REGISTRY_SOURCE_IDS.join(', ')})`);
  if (!source.products.includes(product.id)) throw new Error(`bulk import source "${sourceId}" is for ${source.products.join(', ')}, not ${product.id}`);
  const log = opts.log ?? (() => {});
  const existing = await selectAll<{ source_key: string | null; contact_email: string | null; domain: string | null }>(() => scopeToProduct(db.from(leadsTable(product)).select('id, source_key, contact_email, domain'), product));
  // The leads table allows one lead per (product, domain): franchise brands and shared-email agencies
  // would otherwise fail every chunk insert and force a slow row-by-row retry.
  const knownDomains = new Set(existing.map((r) => (r.domain ?? '').toLowerCase()).filter(Boolean));
  const knownKeys = new Set(existing.map((r) => r.source_key).filter((k): k is string => !!k));
  const knownEmails = new Set(existing.map((r) => (r.contact_email ?? '').toLowerCase()).filter(Boolean));
  const supRows = await selectAll<{ email: string }>(() => db.from(suppressionsTable(product)).select('id, email'));
  const suppressed = new Set(supRows.map((r) => String(r.email).toLowerCase()));
  log(`existing leads: ${existing.length}, suppressed: ${suppressed.size}`);

  const res = await source.load(product, (k) => knownKeys.has(k), log);
  const skipped: Record<string, number> = { ...res.rejected };
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  // A source can list the same business twice (Virginia publishes one row per
  // licence class), so the batch dedupes on source key as well as email.
  const batchKeys = new Set<string>();
  for (const c of res.candidates as RegistryLead[]) {
    if (batchKeys.has(c.sourceKey)) { skipped['duplicate in batch'] = (skipped['duplicate in batch'] ?? 0) + 1; continue; }
    batchKeys.add(c.sourceKey);
    const { email, domain, fields } = registryLeadRow(c, product, now);
    if (email && (knownEmails.has(email) || suppressed.has(email))) { skipped['email already a lead or suppressed'] = (skipped['email already a lead or suppressed'] ?? 0) + 1; continue; }
    if (domain && isBlockedDomain(domain)) { skipped['blocked domain'] = (skipped['blocked domain'] ?? 0) + 1; continue; }
    if (domain && knownDomains.has(domain.toLowerCase())) { skipped['domain already a lead'] = (skipped['domain already a lead'] ?? 0) + 1; continue; }
    if (domain) knownDomains.add(domain.toLowerCase());
    if (email) knownEmails.add(email);
    rows.push({ ...fields, signal_source: 'directory', signal_detail: c.signalDetail.slice(0, 300), last_seen_at: now, ...productInsertFields(product) });
  }
  const errors: string[] = [...res.errors];
  let inserted = 0;
  if (!opts.dryRun) {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await db.from(leadsTable(product)).insert(chunk);
      if (!error) { inserted += chunk.length; }
      else {
        // One bad row must not sink the chunk: retry individually.
        for (const row of chunk) {
          const { error: e1 } = await db.from(leadsTable(product)).insert(row);
          if (e1) errors.push(`insert ${String(row.company_name)}: ${e1.message}`); else inserted++;
        }
      }
      log(`inserted ${inserted}/${rows.length}`);
    }
  }
  return { scanned: res.scanned, candidates: rows.length, inserted, skipped, errors: errors.slice(0, 20) };
}

// Kept for the existing harness entry point and any saved command line.
export async function bulkImportFlDfs(
  db: Db, product: ProductConfig, opts: { dryRun?: boolean; log?: (m: string) => void } = {},
) {
  if (product.id !== 'insurance' && product.id !== 'bailbonds') throw new Error('bulk import is implemented for the Florida DFS verticals (insurance, bailbonds)');
  return bulkImportRegistry(db, product, 'fl-dfs', opts);
}

async function stageRegistry(
  db: Db, summary: RunSummary, dryRun: boolean, index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
): Promise<DirectoryEntry[]> {
  if (!REGISTRY_PRODUCTS.has(product.id)) return [];
  const rawMax = Number(process.env.OUTREACH_REGISTRY_MAX_PER_RUN);
  const max = Math.min(30, Math.max(1, Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 12));
  const isKnown = (key: string) => !!index.find({ sourceKey: key });

  // The Texas workers' compensation subscriber file feeds six of these verticals
  // and takes one rotation slot in six; on the other slots the vertical uses its
  // own source(s).
  const tx = await findTxCandidatesForSlot(product.id, max, { isKnown });
  let res: RegistryResult;
  if (tx) res = tx;
  else if (product.id === 'towing') res = await findTowingCandidates(max, { isKnown });
  else if (product.id === 'septic') res = await findSepticCandidates(max, { isKnown });
  else if (product.id === 'homecare') res = await findHomecareRegistryCandidates(max, { isKnown });
  else if (product.id === 'homeservices') res = await findHomeservicesCandidates(max, { isKnown });
  else if (product.id === 'dental') res = await findDentalNppesCandidates(max, { isKnown });
  else if (product.id === 'childcare') res = await findChildcareCandidates(max, { isKnown });
  else res = await findFlDfsCandidates(product.id as 'insurance' | 'bailbonds', max, { isKnown });
  summary.errors.push(...res.errors);
  summary.searchDebug = { raw: res.scanned, rejected: Object.entries(res.rejected).map(([k, v]) => `${k}: ${v}`) };

  // Only needed for the email-bearing sources; same checks stageFreight makes.
  const withEmail = (res.candidates as RegistryLead[]).some((c) => !!c.email);
  const knownEmails = new Set<string>();
  const suppressed = new Set<string>();
  if (withEmail && !dryRun) {
    const emailRows = await selectAll<{ contact_email: string | null }>(() => scopeToProduct(db.from(leadsTable(product)).select('contact_email, id'), product));
    for (const r of emailRows) if (r.contact_email) knownEmails.add(r.contact_email.toLowerCase());
    const { data: supData } = await db.from(suppressionsTable(product)).select('email');
    for (const s of (supData ?? []) as { email: string }[]) suppressed.add(String(s.email).toLowerCase());
  }

  const entries: DirectoryEntry[] = [];
  const now = new Date().toISOString();
  for (const c of res.candidates as RegistryLead[]) {
    if (stop()) break;
    const { email, domain, fields } = registryLeadRow(c, product, now);
    if (index.find({ sourceKey: c.sourceKey, name: c.name, domain })) continue;
    if (email && (knownEmails.has(email) || suppressed.has(email))) continue;
    if (domain && isBlockedDomain(domain)) continue;
    summary.leadsNew++;
    summary.searchCandidates++;
    if (email) summary.contactsFound++;
    if (email) knownEmails.add(email);
    if (dryRun) {
      const fake = { id: `dry-${c.sourceKey}`, status: 'new', contact_email: null, contact_status: 'unknown', enriched_at: null, ...fields } as LeadRow;
      index.add(fake);
      entries.push({ slug: null, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from(leadsTable(product)).insert({
      ...fields, signal_source: 'directory', signal_detail: c.signalDetail.slice(0, 300), last_seen_at: now, ...productInsertFields(product),
    }).select('*').single();
    if (error) {
      summary.leadsNew--;
      summary.searchCandidates--;
      if (email) summary.contactsFound--;
      summary.errors.push(`insert ${c.name}: ${error.message}`);
    } else if (inserted) {
      index.add(inserted as LeadRow);
      entries.push({ slug: null, row: inserted as LeadRow });
    }
  }
  return entries;
}

async function stageEnrich(
  db: Db, summary: RunSummary, dryRun: boolean, limit: number, entriesIn: DirectoryEntry[], index: LeadIndex<LeadRow>, stop: () => boolean, product: ProductConfig,
) {
  let entries = entriesIn;
  const recheckBefore = Date.now() - RECHECK_DAYS * 86_400_000;
  const isRegistry = REGISTRY_PRODUCTS.has(product.id);
  // Registry leads that could not be looked up in an earlier run (search cap or CLI
  // outage: enriched_at still null) are picked up again here.
  if (isRegistry) {
    const seen = new Set(entries.map((e) => e.row.id));
    for (const row of index.rows()) {
      if (!seen.has(row.id) && row.status === 'new' && !row.domain && !row.enriched_at && row.signals?.registry) entries = [...entries, { row, slug: null }];
    }
  }
  const rawWeb = Number(process.env.OUTREACH_WEBSEARCH_MAX_PER_RUN);
  const webCap = Math.min(30, Math.max(0, Number.isFinite(rawWeb) && rawWeb >= 0 && process.env.OUTREACH_WEBSEARCH_MAX_PER_RUN ? Math.floor(rawWeb) : 12));
  let webLookups = 0;
  let searchFailures = 0;

  const candidates = entries
    .filter((e) => e.row.status !== 'dead' && !e.row.region_blocked)
    .filter((e) => !e.row.enriched_at || (e.row.contact_status !== 'found' && new Date(e.row.enriched_at).getTime() < recheckBefore))
    .sort((a, b) => (b.row.score ?? 0) - (a.row.score ?? 0))
    .slice(0, limit);

  for (const { row: lead, slug } of candidates) {
    if (stop()) break;
    try {
      let domain = lead.domain ?? (slug ? await findAgencyDomain(slug) : null);
      const now = new Date().toISOString();

      // Registry leads have no website: find it by name + city/state and VERIFY it is
      // that business (websiteDiscovery.ts). The LLM search is the cost, so it is capped
      // per run; a failed search (CLI down) leaves the lead unenriched for the next run.
      // Gated on the lead actually CARRYING registry metadata rather than on the
      // product being a registry product: the international sources add registry
      // leads to freight (the DVSA operator licences), which is not in
      // REGISTRY_PRODUCTS because its US source already publishes emails. Leads
      // without signals.registry are unaffected.
      if (!domain && lead.signals?.registry) {
        if (webLookups >= webCap || searchFailures >= 3) {
          summary.sample.enriched.push({ name: lead.company_name, domain: null, email: null, status: 'deferred (website-search cap or outage)' });
          continue;
        }
        webLookups++;
        const reg = lead.signals.registry;
        const found = await discoverWebsite(
          { name: lead.company_name, legalName: reg.legalName, city: reg.city, state: reg.state, phone: reg.phone },
          REGISTRY_KIND[product.id] ?? 'business',
        );
        if (found.status === 'found') {
          domain = found.domain;
        } else if (found.reason.startsWith('search failed')) {
          searchFailures++;
          summary.errors.push(`website search ${lead.company_name}: ${found.reason}`);
          continue;
        } else {
          summary.sample.enriched.push({ name: lead.company_name, domain: found.domain ?? null, email: null, status: `no-site: ${found.reason}` });
          if (!dryRun) await db.from(leadsTable(product)).update({ contact_status: 'none', enriched_at: now }).eq('id', lead.id);
          continue;
        }
      }

      if (!domain) {
        summary.sample.enriched.push({ name: lead.company_name, domain: null, email: null, status: 'no-website' });
        if (!dryRun) await db.from(leadsTable(product)).update({ contact_status: 'none', enriched_at: now }).eq('id', lead.id);
        continue;
      }

      if (isBlockedDomain(domain)) {
        summary.sample.enriched.push({ name: lead.company_name, domain, email: null, status: 'region-blocked-domain' });
        if (!dryRun) await db.from(leadsTable(product)).update({ domain, region_blocked: true, enriched_at: now }).eq('id', lead.id);
        continue;
      }

      const clash = index.findByDomainOtherThan(domain, lead.id);
      if (clash) {
        summary.duplicatesSkipped++;
        summary.sample.enriched.push({ name: lead.company_name, domain, email: null, status: `duplicate-of:${clash.company_name}` });
        if (!dryRun) {
          await db.from(leadsTable(product)).update({
            status: 'dead', enriched_at: now, signal_detail: `Duplicate of ${clash.company_name} (same website ${domain})`,
          }).eq('id', lead.id);
        }
        continue;
      }
      index.setDomain(lead, domain);

      const contact = await findContact(domain);
      if (contact.status === 'found') summary.contactsFound++;
      summary.sample.enriched.push({ name: lead.company_name, domain, email: contact.email, status: contact.status });

      const techPlatforms = await checkDomainForPlatforms(domain);
      if (techPlatforms.length) summary.techFingerprintHits++;
      const evidence: ScoreEvidence = {
        techPlatforms,
        viaJobPosting: lead.source_key?.startsWith('job_posting:') ?? false,
        viaReviewSite: lead.source_key?.startsWith('review_site:') ?? false,
      };
      const reg = lead.signals?.registry;
      const scored = scoreLead({ tier: lead.tier, location: lead.location, description: reg ? `${lead.company_name} ${lead.description ?? ''}` : lead.description }, evidence, product);
      const rescored = reg ? Math.max(0, Math.min(100, scored.score + reg.adjust)) : scored.score;
      const reasons = reg ? [...scored.reasons, ...reg.reasons] : scored.reasons;

      if (dryRun) continue;
      const suppressed = contact.email
        ? (await db.from(suppressionsTable(product)).select('id').eq('email', contact.email).maybeSingle()).data
        : null;
      const { error } = await db.from(leadsTable(product)).update({
        domain,
        contact_email: contact.email,
        contact_status: contact.status,
        contact_source_url: contact.sourceUrl,
        enriched_at: now,
        score: rescored,
        signals: { reasons, techPlatforms, ...(reg ? { registry: reg } : {}), ...(contact.form ? { contactForm: contact.form } : {}), ...(lead.signals?.formOutreach ? { formOutreach: lead.signals.formOutreach } : {}) },
        ...(suppressed ? { status: 'dead' } : {}),
      }).eq('id', lead.id);
      if (error) summary.errors.push(`enrich ${lead.company_name}: ${error.message}`);
    } catch (error) {
      summary.errors.push(`enrich ${lead.company_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Research stage (Mac mini harness only, OUTREACH_RESEARCH=1): a restricted Claude
// agent reads each qualified lead's own site and stores a dossier. Low-fit leads are
// retired here so they never reach the review queue.
async function stageResearch(db: Db, summary: RunSummary, dryRun: boolean, limit: number, stop: () => boolean, product: ProductConfig) {
  if (limit <= 0) return;
  const { data } = await scopeToProduct(db.from(leadsTable(product)).select('*')
    .eq('status', 'new').eq('contact_status', 'found').eq('region_blocked', false)
    .is('researched_at', null).not('domain', 'is', null).gte('score', MIN_DRAFT_SCORE), product)
    .order('score', { ascending: false }).limit(limit);

  for (const lead of (data ?? []) as LeadRow[]) {
    if (stop()) break;
    try {
      const dossier = researchAgency({ name: lead.company_name, domain: lead.domain as string, description: lead.description });
      summary.researched++;
      if (dossier.fit === 'low') summary.lowFit++;
      summary.sample.researched.push({ name: lead.company_name, fit: dossier.fit, hook: dossier.hook, sources: dossier.sources.length });
      if (dryRun) continue;
      const { error } = await db.from(leadsTable(product)).update({
        research: dossier, researched_at: new Date().toISOString(), fit: dossier.fit,
        ...(dossier.fit === 'low' ? { status: 'dead', signal_detail: `Low fit: ${dossier.fit_reason}`.slice(0, 300) } : {}),
      }).eq('id', lead.id);
      if (error) summary.errors.push(`research store ${lead.company_name}: ${error.message}`);
    } catch (error) {
      summary.errors.push(`research ${lead.company_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function stageDraft(db: Db, summary: RunSummary, dryRun: boolean, limit: number, stop: () => boolean, researchOn = false, product: ProductConfig = calldesk) {
  if (dryRun) return;
  if (limit <= 0) return;
  let query = scopeToProduct(db.from(leadsTable(product)).select('*')
    .eq('status', 'new').eq('contact_status', 'found').eq('region_blocked', false).gte('score', MIN_DRAFT_SCORE), product);
  // With research on, only researched, non-low-fit leads get drafted.
  if (researchOn) query = query.not('researched_at', 'is', null).in('fit', ['high', 'medium', 'unclear']);
  const { data } = await query.order('score', { ascending: false }).limit(200);
  const leads = (data ?? []) as LeadRow[];
  if (!leads.length) return;

  const { data: msgsData } = await scopeToProduct(db.from(messagesTable(product)).select('lead_id,to_email,status'), product);
  const msgs = (msgsData ?? []) as { lead_id: string; to_email: string; status: string }[];
  const drafted = new Set(msgs.filter((m) => m.status !== 'rejected').map((m) => m.lead_id));
  const emailed = new Set(msgs.filter((m) => m.status !== 'rejected').map((m) => String(m.to_email).toLowerCase()));
  // No product scope: the suppressions table has no `product` column (migration 029/042), so
  // scoping errored and silently returned no rows. Suppression is global by email, as in sender.ts.
  const { data: supData } = await db.from(suppressionsTable(product)).select('email');
  const sup = (supData ?? []) as { email: string }[];
  const suppressed = new Set(sup.map((s) => String(s.email).toLowerCase()));

  let made = 0;
  for (const lead of leads) {
    if (made >= limit || stop()) break;
    const email = (lead.contact_email ?? '').toLowerCase();
    if (!email || drafted.has(lead.id) || emailed.has(email) || suppressed.has(email)) continue;
    try {
      const draft = await draftAgencyEmail({
        name: lead.company_name, domain: lead.domain, tier: lead.tier, location: lead.location, description: lead.description,
        dossier: lead.research ?? null, product,
      });
      const { error } = await db.from(messagesTable(product)).insert({
        lead_id: lead.id, to_email: email, subject: draft.subject, body_text: draft.body, status: 'draft',
        sources: lead.research?.sources ?? [],
        translation_subject: draft.translationSubject ?? null, translation_body: draft.translationBody ?? null,
        ...productInsertFields(product),
      });
      if (error) throw new Error(error.message);
      await db.from(leadsTable(product)).update({ status: 'report_generated', updated_at: new Date().toISOString() }).eq('id', lead.id);
      emailed.add(email);
      made++;
      summary.draftsCreated++;
    } catch (error) {
      summary.errors.push(`draft ${lead.company_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Contact-form leads (no public email): a human submits the drafted message through the practice's own
// form. The draft and its status live on the lead (signals.formOutreach) because a message row needs a
// recipient email. Same drafting prompt as emails; nothing is submitted automatically.
async function stageFormDrafts(db: Db, summary: RunSummary, dryRun: boolean, limit: number, stop: () => boolean, product: ProductConfig) {
  if (dryRun || limit <= 0) return;
  const { data } = await scopeToProduct(db.from(leadsTable(product)).select('*')
    .eq('status', 'new').eq('contact_status', 'form_only').eq('region_blocked', false).gte('score', MIN_DRAFT_SCORE), product)
    .order('score', { ascending: false }).limit(200);
  const leads = ((data ?? []) as LeadRow[]).filter((l) => l.signals?.contactForm && !l.signals?.formOutreach);
  let made = 0;
  for (const lead of leads) {
    if (made >= limit || stop()) break;
    try {
      const draft = await draftAgencyEmail({
        name: lead.company_name, domain: lead.domain, tier: lead.tier, location: lead.location, description: lead.description,
        dossier: lead.research ?? null, product,
      });
      const { error } = await db.from(leadsTable(product)).update({
        signals: { ...lead.signals, formOutreach: { subject: draft.subject, body: draft.body, status: 'ready', draftedAt: new Date().toISOString() } },
        updated_at: new Date().toISOString(),
      }).eq('id', lead.id);
      if (error) throw new Error(error.message);
      made++;
      summary.formDrafts = (summary.formDrafts ?? 0) + 1;
    } catch (error) {
      summary.errors.push(`form draft ${lead.company_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Follow-ups: most people don't reply to a single cold email. A lead whose
// last message was sent (and never marked replied_at, which only a human
// reviewing the queue sets — there is no automated reply detection) gets a
// short follow-up drafted after a delay, capped at MAX_FOLLOWUPS touches
// total. Off entirely if OUTREACH_MAX_FOLLOWUPS is set to 0 or less.
const DEFAULT_FOLLOWUP_DELAY_DAYS = 4;
const DEFAULT_MAX_FOLLOWUPS = 3;

async function stageFollowUp(db: Db, summary: RunSummary, dryRun: boolean, stop: () => boolean, product: ProductConfig) {
  if (dryRun) return;
  const delayDays = Math.max(1, Number(process.env.OUTREACH_FOLLOWUP_DELAY_DAYS) || DEFAULT_FOLLOWUP_DELAY_DAYS);
  // Number(undefined) is NaN, and `??` does not treat NaN as absent (only null/undefined
  // are) -- so an unset env var must be checked with isNaN, not `||`/`??`, or it silently
  // stays NaN and `!maxFollowUps` (NaN is falsy) makes this stage a permanent no-op.
  const rawMaxFollowUps = Number(process.env.OUTREACH_MAX_FOLLOWUPS);
  const maxFollowUps = Math.max(0, Number.isNaN(rawMaxFollowUps) ? (product.vertical?.defaultMaxFollowUps ?? DEFAULT_MAX_FOLLOWUPS) : rawMaxFollowUps);
  if (!maxFollowUps) return;

  let budget = Infinity;

  const cutoff = new Date(Date.now() - delayDays * 86_400_000).toISOString();
  const { data: leads } = await scopeToProduct(db.from(leadsTable(product)).select('*')
    .eq('status', 'sent').eq('region_blocked', false).is('replied_at', null), product).limit(200);
  if (!leads?.length) return;

  for (const lead of leads as LeadRow[]) {
    if (budget <= 0 || stop()) break;
    try {
      const { data: msgs } = await db.from(messagesTable(product)).select('*').eq('lead_id', lead.id).neq('status', 'rejected').order('step', { ascending: false });
      const latest = msgs?.[0];
      if (!latest || latest.status !== 'sent' || !latest.sent_at) continue; // a pending draft/approved earlier step is still in flight
      if (latest.sent_at > cutoff) continue; // too soon
      const nextStep = (latest.step ?? 1) + 1;
      if (nextStep > maxFollowUps) continue; // sequence exhausted

      const draft = await draftFollowUpEmail({
        name: lead.company_name, domain: lead.domain, tier: lead.tier, location: lead.location, description: lead.description,
        dossier: lead.research ?? null, previousSubject: latest.subject, step: nextStep, isFinal: nextStep >= maxFollowUps, product,
      });
      const { error } = await db.from(messagesTable(product)).insert({
        lead_id: lead.id, to_email: latest.to_email, subject: draft.subject, body_text: draft.body, status: 'draft',
        step: nextStep, sources: lead.research?.sources ?? [],
        translation_subject: draft.translationSubject ?? null, translation_body: draft.translationBody ?? null,
        ...productInsertFields(product),
      });
      if (error) throw new Error(error.message);
      budget--;
      summary.followUpsCreated++;
    } catch (error) {
      summary.errors.push(`follow-up ${lead.company_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function notify(db: Db, summary: RunSummary, product: ProductConfig) {
  const to = process.env.OUTREACH_ALERT_EMAIL || adminEmails()[0];
  if (!to) return;
  const base = (process.env.NEXT_PUBLIC_APP_URL || product.baseUrl).replace(/\/$/, '');

  const { data: recentData } = await scopeToProduct(db.from(runsTable(product)).select('status,leads_seen').eq('dry_run', false)
    .not('finished_at', 'is', null), product).order('started_at', { ascending: false }).limit(3);
  const recent = (recentData ?? []) as { status: string; leads_seen: number }[];
  const zeroStreak = recent.length === 3 && recent.every((r) => r.status === 'ok' && r.leads_seen === 0);

  if (summary.status === 'error' || summary.errors.length || zeroStreak) {
    const reason = zeroStreak ? 'Discovery saw 0 agencies 3 runs in a row (the directory page may have changed).' : 'Discovery run had errors.';
    await sendEmail({
      to,
      subject: 'Outreach discovery needs attention',
      html: `<p>${reason}</p><pre>${summary.errors.slice(0, 10).join('\n') || '(no error text)'}</pre>`,
      text: `${reason}\n${summary.errors.slice(0, 10).join('\n')}`,
    });
  }

  if (summary.leadsNew > 0 || summary.draftsCreated > 0 || summary.followUpsCreated > 0) {
    const total = summary.draftsCreated + summary.followUpsCreated;
    const line = `${summary.leadsNew} new ${product.vertical?.leadPlural ?? 'agencies'}, ${summary.contactsFound} contacts found, ${summary.draftsCreated} first-touch drafts + ${summary.followUpsCreated} follow-ups awaiting your approval.`;
    await sendEmail({
      to,
      subject: `Outreach: ${total} drafts to review`,
      html: `<p>${line}</p><p><a href="${base}/admin/outreach/queue">Review the queue</a></p>`,
      text: `${line}\n${base}/admin/outreach/queue`,
    });
  }
}
