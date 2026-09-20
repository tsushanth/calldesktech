import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { adminEmails } from '../adminAuth';
import { draftAgencyEmail } from '../agencyDraft';
import { fetchDirectory } from './retellDirectory';
import { findAgencyDomain } from './findDomain';
import { findContact } from './contactPages';
import { isBlockedDomain, isRegionBlocked, scoreLead } from './score';
import { LeadIndex } from './dedupe';

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
}

export interface RunSummary {
  runId: string | null;
  dryRun: boolean;
  status: 'ok' | 'error';
  directoryCount: number;
  leadsSeen: number;
  leadsNew: number;
  duplicatesSkipped: number;
  contactsFound: number;
  draftsCreated: number;
  errors: string[];
  sample: { enriched: { name: string; domain: string | null; email: string | null; status: string }[] };
}

const MIN_DRAFT_SCORE = 40;
const RECHECK_DAYS = 30;

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
}

export async function runDiscovery(db: Db, opts: RunOptions = {}): Promise<RunSummary> {
  const dryRun = !!opts.dryRun;
  const enrichLimit = opts.enrichLimit ?? 25;
  const draftLimit = opts.draftLimit ?? 10;

  const summary: RunSummary = {
    runId: null, dryRun, status: 'ok', directoryCount: 0, leadsSeen: 0, leadsNew: 0,
    duplicatesSkipped: 0, contactsFound: 0, draftsCreated: 0, errors: [], sample: { enriched: [] },
  };

  if (!dryRun) {
    const { data } = await db.from('calldesk_outreach_runs').insert({ dry_run: false }).select('id').single();
    summary.runId = data?.id ?? null;
  }

  try {
    const { entries, index } = await stageDirectory(db, summary, dryRun);
    await stageEnrich(db, summary, dryRun, enrichLimit, entries, index);
    await stageDraft(db, summary, dryRun, draftLimit);
  } catch (error) {
    summary.status = 'error';
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }

  if (!dryRun) {
    if (summary.runId) {
      await db.from('calldesk_outreach_runs').update({
        finished_at: new Date().toISOString(),
        status: summary.status,
        leads_seen: summary.leadsSeen,
        leads_new: summary.leadsNew,
        contacts_found: summary.contactsFound,
        drafts_created: summary.draftsCreated,
        errors: summary.errors.slice(0, 50),
      }).eq('id', summary.runId);
    }
    await notify(db, summary);
  }
  return summary;
}

interface DirectoryEntry {
  row: LeadRow;
  slug: string;
}

async function stageDirectory(
  db: Db, summary: RunSummary, dryRun: boolean,
): Promise<{ entries: DirectoryEntry[]; index: LeadIndex<LeadRow> }> {
  const partners = await fetchDirectory();
  const entries: DirectoryEntry[] = [];
  const handled = new Set<string>();
  summary.directoryCount = partners.length;

  const { data: existing } = await db.from('calldesk_outreach_leads').select('*');
  const index = new LeadIndex<LeadRow>((existing ?? []) as LeadRow[]);
  const now = new Date().toISOString();

  for (const p of partners) {
    const sourceKey = `retell:${p.slug}`;
    const score = scoreLead({ tier: p.tier, location: p.location, description: p.description });
    const blocked = isRegionBlocked(p.location, p.name);
    const match = index.find({ sourceKey, name: p.name });

    if (match) {
      // Two directory listings can map to one lead (e.g. a company listed twice): handle it once.
      if (handled.has(match.id)) continue;
      handled.add(match.id);
      summary.leadsSeen++;
      entries.push({
        slug: p.slug,
        row: { ...match, source_key: match.source_key ?? sourceKey, tier: p.tier, location: p.location, description: p.description, score, region_blocked: blocked },
      });
      if (dryRun) continue;
      const { error } = await db.from('calldesk_outreach_leads').update({
        source_key: match.source_key ?? sourceKey,
        tier: p.tier, location: p.location, description: p.description,
        score, region_blocked: blocked, last_seen_at: now,
      }).eq('id', match.id);
      if (error) summary.errors.push(`update ${p.name}: ${error.message}`);
      continue;
    }

    summary.leadsNew++;
    if (dryRun) {
      const fake = {
        id: `dry-${p.slug}`, company_name: p.name, domain: null, source_key: sourceKey, status: 'new', contact_email: null,
        contact_status: 'unknown', region_blocked: blocked, tier: p.tier, location: p.location, description: p.description, score, enriched_at: null,
      } as LeadRow;
      index.add(fake);
      entries.push({ slug: p.slug, row: fake });
      continue;
    }
    const { data: inserted, error } = await db.from('calldesk_outreach_leads').insert({
      company_name: p.name,
      signal_source: 'directory',
      signal_detail: `Retell ${p.tier ?? 'partner'}: ${(p.description ?? '').slice(0, 200)}`,
      source_key: sourceKey, tier: p.tier, location: p.location, description: p.description,
      score, region_blocked: blocked, last_seen_at: now,
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

async function stageEnrich(
  db: Db, summary: RunSummary, dryRun: boolean, limit: number, entries: DirectoryEntry[], index: LeadIndex<LeadRow>,
) {
  const recheckBefore = Date.now() - RECHECK_DAYS * 86_400_000;

  const candidates = entries
    .filter((e) => e.row.status !== 'dead' && !e.row.region_blocked)
    .filter((e) => !e.row.enriched_at || (e.row.contact_status !== 'found' && new Date(e.row.enriched_at).getTime() < recheckBefore))
    .sort((a, b) => (b.row.score ?? 0) - (a.row.score ?? 0))
    .slice(0, limit);

  for (const { row: lead, slug } of candidates) {
    try {
      const domain = lead.domain ?? (await findAgencyDomain(slug));
      const now = new Date().toISOString();

      if (!domain) {
        summary.sample.enriched.push({ name: lead.company_name, domain: null, email: null, status: 'no-website' });
        if (!dryRun) await db.from('calldesk_outreach_leads').update({ contact_status: 'none', enriched_at: now }).eq('id', lead.id);
        continue;
      }

      if (isBlockedDomain(domain)) {
        summary.sample.enriched.push({ name: lead.company_name, domain, email: null, status: 'region-blocked-domain' });
        if (!dryRun) await db.from('calldesk_outreach_leads').update({ domain, region_blocked: true, enriched_at: now }).eq('id', lead.id);
        continue;
      }

      const clash = index.findByDomainOtherThan(domain, lead.id);
      if (clash) {
        summary.duplicatesSkipped++;
        summary.sample.enriched.push({ name: lead.company_name, domain, email: null, status: `duplicate-of:${clash.company_name}` });
        if (!dryRun) {
          await db.from('calldesk_outreach_leads').update({
            status: 'dead', enriched_at: now, signal_detail: `Duplicate of ${clash.company_name} (same website ${domain})`,
          }).eq('id', lead.id);
        }
        continue;
      }
      index.setDomain(lead, domain);

      const contact = await findContact(domain);
      if (contact.status === 'found') summary.contactsFound++;
      summary.sample.enriched.push({ name: lead.company_name, domain, email: contact.email, status: contact.status });

      if (dryRun) continue;
      const suppressed = contact.email
        ? (await db.from('calldesk_outreach_suppressions').select('id').eq('email', contact.email).maybeSingle()).data
        : null;
      const { error } = await db.from('calldesk_outreach_leads').update({
        domain,
        contact_email: contact.email,
        contact_status: contact.status,
        contact_source_url: contact.sourceUrl,
        enriched_at: now,
        ...(suppressed ? { status: 'dead' } : {}),
      }).eq('id', lead.id);
      if (error) summary.errors.push(`enrich ${lead.company_name}: ${error.message}`);
    } catch (error) {
      summary.errors.push(`enrich ${lead.company_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function stageDraft(db: Db, summary: RunSummary, dryRun: boolean, limit: number) {
  if (dryRun) return;
  const { data } = await db.from('calldesk_outreach_leads').select('*')
    .eq('status', 'new').eq('contact_status', 'found').eq('region_blocked', false).gte('score', MIN_DRAFT_SCORE)
    .order('score', { ascending: false }).limit(200);
  const leads = (data ?? []) as LeadRow[];
  if (!leads.length) return;

  const { data: msgs } = await db.from('calldesk_outreach_messages').select('lead_id,to_email,status');
  const drafted = new Set((msgs ?? []).filter((m) => m.status !== 'rejected').map((m) => m.lead_id as string));
  const emailed = new Set((msgs ?? []).filter((m) => m.status !== 'rejected').map((m) => String(m.to_email).toLowerCase()));
  const { data: sup } = await db.from('calldesk_outreach_suppressions').select('email');
  const suppressed = new Set((sup ?? []).map((s) => String(s.email).toLowerCase()));

  let made = 0;
  for (const lead of leads) {
    if (made >= limit) break;
    const email = (lead.contact_email ?? '').toLowerCase();
    if (!email || drafted.has(lead.id) || emailed.has(email) || suppressed.has(email)) continue;
    try {
      const draft = await draftAgencyEmail({
        name: lead.company_name, domain: lead.domain, tier: lead.tier, location: lead.location, description: lead.description,
      });
      const { error } = await db.from('calldesk_outreach_messages').insert({
        lead_id: lead.id, to_email: email, subject: draft.subject, body_text: draft.body, status: 'draft',
      });
      if (error) throw new Error(error.message);
      await db.from('calldesk_outreach_leads').update({ status: 'report_generated', updated_at: new Date().toISOString() }).eq('id', lead.id);
      emailed.add(email);
      made++;
      summary.draftsCreated++;
    } catch (error) {
      summary.errors.push(`draft ${lead.company_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function notify(db: Db, summary: RunSummary) {
  const to = process.env.OUTREACH_ALERT_EMAIL || adminEmails()[0];
  if (!to) return;
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');

  const { data: recent } = await db.from('calldesk_outreach_runs').select('status,leads_seen').eq('dry_run', false)
    .not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(3);
  const zeroStreak = (recent ?? []).length === 3 && (recent ?? []).every((r) => r.status === 'ok' && r.leads_seen === 0);

  if (summary.status === 'error' || summary.errors.length || zeroStreak) {
    const reason = zeroStreak ? 'Discovery saw 0 agencies 3 runs in a row (the directory page may have changed).' : 'Discovery run had errors.';
    await sendEmail({
      to,
      subject: 'Outreach discovery needs attention',
      html: `<p>${reason}</p><pre>${summary.errors.slice(0, 10).join('\n') || '(no error text)'}</pre>`,
      text: `${reason}\n${summary.errors.slice(0, 10).join('\n')}`,
    });
  }

  if (summary.leadsNew > 0 || summary.draftsCreated > 0) {
    const line = `${summary.leadsNew} new agencies, ${summary.contactsFound} contacts found, ${summary.draftsCreated} drafts awaiting your approval.`;
    await sendEmail({
      to,
      subject: `Outreach: ${summary.draftsCreated} drafts to review`,
      html: `<p>${line}</p><p><a href="${base}/admin/outreach/queue">Review the queue</a></p>`,
      text: `${line}\n${base}/admin/outreach/queue`,
    });
  }
}
