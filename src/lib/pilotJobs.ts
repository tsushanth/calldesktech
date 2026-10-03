import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail as defaultSendEmail, type SendEmailParams, type SendEmailResult } from '@/lib/email';
import { escapeHtml } from '@/lib/outreach/emailHtml';
import {
  computeAlertEvents,
  computePilotStats,
  formatMinutes,
  topSummaryTopics,
  callSummary,
  pilotCalls,
  type PilotAlertEvent,
  type PilotCall,
  type PilotRow,
  type PilotStats,
  type PilotStatus,
} from '@/lib/pilots';

// Data loading and the two cron jobs (hourly watch, weekly digest) behind /api/cron/pilot-watch and /api/cron/pilot-weekly-report.
// Emails go to PILOT_ALERT_EMAIL only, never to a pilot's contact. Nothing is sent without PILOT_ALERT_EMAIL and RESEND_API_KEY.

export type Db = SupabaseClient;
type Env = Record<string, string | undefined>;
export type SendFn = (p: SendEmailParams) => Promise<SendEmailResult>;

export interface PilotWithCalls {
  pilot: PilotRow;
  tenantName: string | null;
  tenantBlocked: boolean | null; // null: column pilot_blocked does not exist yet
  calls: PilotCall[];
}

interface DbErr { code?: string; message?: string }
// 42P01 undefined table, PGRST205 table not in schema cache, 42703 undefined column, PGRST204 column not in schema cache.
export const isMissingTable = (e: DbErr | null | undefined) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || '') && /calldesk_pilot/.test(e.message || ''));
export const isMissingColumn = (e: DbErr | null | undefined) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /pilot_blocked/.test(e.message || ''));
const isUniqueViolation = (e: DbErr | null | undefined) => !!e && (e.code === '23505' || /duplicate key/i.test(e.message || ''));

const CALL_COLUMNS = 'id, created_at, duration_seconds, outcome, analysis, is_internal_test';

export async function loadCallsForPilot(db: Db, pilot: Pick<PilotRow, 'tenant_id' | 'started_at'>): Promise<PilotCall[]> {
  const { data, error } = await db
    .from('calldesk_call_logs')
    .select(CALL_COLUMNS)
    .eq('tenant_id', pilot.tenant_id)
    .gte('created_at', pilot.started_at)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as unknown as PilotCall[];
}

export async function loadTenantInfo(db: Db, ids: string[]): Promise<Map<string, { name: string | null; blocked: boolean | null }>> {
  const out = new Map<string, { name: string | null; blocked: boolean | null }>();
  if (!ids.length) return out;
  type TenantRes = { data: unknown[] | null; error: DbErr | null };
  let res: TenantRes = await db.from('calldesk_tenants').select('id, name, pilot_blocked').in('id', ids);
  let hasFlag = true;
  if (res.error && isMissingColumn(res.error)) {
    hasFlag = false;
    res = await db.from('calldesk_tenants').select('id, name').in('id', ids);
  }
  if (res.error) throw res.error;
  for (const t of (res.data ?? []) as unknown as Array<{ id: string; name: string | null; pilot_blocked?: boolean | null }>) {
    out.set(t.id, { name: t.name ?? null, blocked: hasFlag ? !!t.pilot_blocked : null });
  }
  return out;
}

/** All pilots with their calls. `missingTable` is true when migration 068 has not been applied. */
export async function loadPilots(db: Db): Promise<{ rows: PilotWithCalls[]; missingTable: boolean }> {
  const { data, error } = await db.from('calldesk_pilots').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) {
    if (isMissingTable(error)) return { rows: [], missingTable: true };
    throw error;
  }
  const pilots = (data ?? []) as unknown as PilotRow[];
  const tenants = await loadTenantInfo(db, pilots.map((p) => p.tenant_id));
  const rows: PilotWithCalls[] = [];
  for (const pilot of pilots) {
    const t = tenants.get(pilot.tenant_id);
    rows.push({ pilot, tenantName: t?.name ?? null, tenantBlocked: t ? t.blocked : null, calls: await loadCallsForPilot(db, pilot) });
  }
  return { rows, missingTable: false };
}

/**
 * Writes calldesk_tenants.pilot_blocked (and reason/time). Does nothing, and returns 'no_column', when migration 068 has not added the
 * column, so the web app works before and after the migration.
 */
export async function syncBlockFlag(db: Db, tenantId: string, blocked: boolean, reason: string | null, now: Date): Promise<'written' | 'no_column' | 'error'> {
  const { error } = await db
    .from('calldesk_tenants')
    .update({ pilot_blocked: blocked, pilot_blocked_reason: blocked ? reason : null, pilot_blocked_at: blocked ? now.toISOString() : null })
    .eq('id', tenantId);
  if (!error) return 'written';
  if (isMissingColumn(error)) return 'no_column';
  console.error('[pilot] block flag write failed:', error.message);
  return 'error';
}

// ---- Hourly watch ----------------------------------------------------------------------------------------------------

export interface PlannedEmail {
  pilotId: string;
  company: string;
  keys: string[];
  kinds: string[];
  to: string | null;
  subject: string;
  text: string;
  html: string;
  result?: 'sent' | 'failed' | 'already_sent' | 'would_send' | 'not_configured';
}

export interface WatchResult {
  dry: boolean;
  configured: boolean;
  skipped?: string;
  pilots: number;
  statusChanges: Array<{ pilotId: string; from: PilotStatus; to: PilotStatus }>;
  flagChanges: Array<{ tenantId: string; blocked: boolean; applied: boolean }>;
  emails: PlannedEmail[];
}

export const pilotLabel = (p: PilotRow, tenantName: string | null) => p.company || tenantName || p.contact_name || p.id.slice(0, 8);
const siteUrl = (env: Env) => (env.NEXTAUTH_URL || 'https://calldesk.tech').replace(/\/$/, '');

const SUBJECT: Record<string, string> = {
  cap_80: 'at 80% of its minute cap',
  cap_100: 'hit its minute cap',
  no_calls_24h: 'has no calls after 24 hours',
  expiring_24h: 'ends within 24 hours',
};

export function planEmails(label: string, pilotId: string, events: PilotAlertEvent[], env: Env): PlannedEmail[] {
  const link = `${siteUrl(env)}/admin/pilots/${pilotId}`;
  const to = env.PILOT_ALERT_EMAIL || null;
  const mk = (subject: string, evs: PilotAlertEvent[]): PlannedEmail => {
    const lines = evs.map((e) => e.line);
    const text = `${label}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\n${link}\n`;
    const html = `<p><strong>${escapeHtml(label)}</strong></p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul><p><a href="${escapeHtml(link)}">Open pilot</a></p>`;
    return { pilotId, company: label, keys: evs.map((e) => e.key), kinds: evs.map((e) => e.kind), to, subject, text, html };
  };
  const out: PlannedEmail[] = [];
  for (const e of events.filter((x) => x.kind !== 'failed_call' && x.kind !== 'short_call')) out.push(mk(`Pilot ${label}: ${SUBJECT[e.kind]}`, [e]));
  const callEvents = events.filter((x) => x.kind === 'failed_call' || x.kind === 'short_call');
  if (callEvents.length) out.push(mk(`Pilot ${label}: ${callEvents.length} call${callEvents.length === 1 ? '' : 's'} need a look`, callEvents));
  return out;
}

async function sentKeys(db: Db, keys: string[]): Promise<{ set: Set<string>; missing: boolean }> {
  if (!keys.length) return { set: new Set(), missing: false };
  const { data, error } = await db.from('calldesk_pilot_events').select('event_key').in('event_key', keys);
  if (error) {
    if (isMissingTable(error)) return { set: new Set(), missing: true };
    throw error;
  }
  return { set: new Set(((data ?? []) as Array<{ event_key: string }>).map((r) => r.event_key)), missing: false };
}

/** Claims markers first (the unique key makes concurrent runs safe), then sends; a failed send releases the claim so the next run retries. */
async function claimAndSend(db: Db, e: PlannedEmail, send: SendFn): Promise<PlannedEmail['result']> {
  const claimed: string[] = [];
  for (const key of e.keys) {
    const { error } = await db.from('calldesk_pilot_events').insert({ pilot_id: e.pilotId, event_key: key });
    if (!error) claimed.push(key);
    else if (!isUniqueViolation(error)) throw error;
  }
  if (!claimed.length) return 'already_sent';
  const res = await send({ to: e.to as string, subject: e.subject, html: e.html, text: e.text });
  if (res.ok) return 'sent';
  for (const key of claimed) await db.from('calldesk_pilot_events').delete().eq('event_key', key);
  return 'failed';
}

export async function runPilotWatch(db: Db, opts: { dry?: boolean; now?: Date; env?: Env; send?: SendFn } = {}): Promise<WatchResult> {
  const dry = !!opts.dry;
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const send = opts.send ?? defaultSendEmail;
  const configured = !!env.PILOT_ALERT_EMAIL && !!env.RESEND_API_KEY;
  const result: WatchResult = { dry, configured, pilots: 0, statusChanges: [], flagChanges: [], emails: [] };

  const { rows, missingTable } = await loadPilots(db);
  if (missingTable) return { ...result, skipped: 'calldesk_pilots does not exist: migration 068 not applied' };
  result.pilots = rows.length;

  const planned: PlannedEmail[] = [];
  for (const { pilot, tenantName, tenantBlocked, calls } of rows) {
    const stats = computePilotStats(pilot, calls, now);

    // Keep status and the engine-facing block flag in step with usage and dates. Writes are skipped in dry-run.
    if (stats.effectiveStatus !== pilot.status) {
      result.statusChanges.push({ pilotId: pilot.id, from: pilot.status, to: stats.effectiveStatus });
      if (!dry) await db.from('calldesk_pilots').update({ status: stats.effectiveStatus }).eq('id', pilot.id);
    }
    if (tenantBlocked !== null && tenantBlocked !== stats.blocked) {
      let applied = false;
      if (!dry) applied = (await syncBlockFlag(db, pilot.tenant_id, stats.blocked, stats.blockReason, now)) === 'written';
      result.flagChanges.push({ tenantId: pilot.tenant_id, blocked: stats.blocked, applied });
    }

    const events = computeAlertEvents(pilot, calls, now);
    if (!events.length) continue;
    const { set, missing } = await sentKeys(db, events.map((e) => e.key));
    if (missing) return { ...result, skipped: 'calldesk_pilot_events does not exist: migration 068 not applied' };
    const fresh = events.filter((e) => !set.has(e.key));
    planned.push(...planEmails(pilotLabel(pilot, tenantName), pilot.id, fresh, env));
  }

  for (const e of planned) {
    if (dry) e.result = 'would_send';
    else if (!configured) e.result = 'not_configured';
    else e.result = await claimAndSend(db, e, send);
    result.emails.push(e);
  }
  if (!dry && !configured && planned.length) result.skipped = 'PILOT_ALERT_EMAIL or RESEND_API_KEY not set: nothing sent, no markers written';
  return result;
}

// ---- Weekly digest ---------------------------------------------------------------------------------------------------

export interface DigestPilot { pilot: PilotRow; label: string; stats: PilotStats; callsThisWeek: number }
export interface Digest {
  weekKey: string;
  subject: string;
  text: string;
  html: string;
  pilots: number;
  topics: Array<{ topic: string; count: number }>;
}

/** UTC date (YYYY-MM-DD) of the Monday that starts the week containing `now`; the weekly send is keyed on it. */
export function weekKeyFor(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const DAY = 86400_000;

/** Pilots worth reporting on: not stopped, and still running or ended in the last 14 days. */
export function digestPilots(rows: PilotWithCalls[], now: Date): DigestPilot[] {
  return rows
    .filter(({ pilot }) => pilot.status !== 'stopped' && (pilot.status === 'active' || Date.parse(pilot.ends_at) >= now.getTime() - 14 * DAY))
    .map(({ pilot, tenantName, calls }) => ({
      pilot,
      label: pilotLabel(pilot, tenantName),
      stats: computePilotStats(pilot, calls, now),
      callsThisWeek: pilotCalls(pilot, calls).filter((c) => Date.parse(c.created_at) >= now.getTime() - 7 * DAY).length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function buildWeeklyDigest(rows: PilotWithCalls[], now: Date, env: Env = {}): Digest {
  const list = digestPilots(rows, now);
  const weekKey = weekKeyFor(now);
  const summaries: string[] = [];
  for (const r of rows) {
    if (!list.find((d) => d.pilot.id === r.pilot.id)) continue;
    for (const c of pilotCalls(r.pilot, r.calls)) {
      const s = callSummary(c);
      if (s) summaries.push(s);
    }
  }
  const topics = topSummaryTopics(summaries);
  const totalCalls = list.reduce((a, d) => a + d.stats.calls, 0);
  const totalMin = list.reduce((a, d) => a + d.stats.minutesUsed, 0);

  const t: string[] = [`Pilot digest for the week of ${weekKey}`, `${list.length} pilots, ${totalCalls} calls, ${formatMinutes(totalMin)} minutes in total.`, ''];
  const h: string[] = [`<h2>Pilot digest: week of ${escapeHtml(weekKey)}</h2>`, `<p>${list.length} pilots, ${totalCalls} calls, ${formatMinutes(totalMin)} minutes in total.</p>`];
  for (const d of list) {
    const s = d.stats;
    const outcomes = Object.entries(s.outcomes).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    const head = `${d.label} [${s.effectiveStatus}]`;
    const usage = `${s.calls} calls (${d.callsThisWeek} this week), ${formatMinutes(s.minutesUsed)} of ${d.pilot.minutes_cap} min (${Math.round(s.percentOfCap)}%), ${s.daysLeft} days left`;
    const detail = `Outcomes: ${outcomes}. Failed: ${s.failedCalls}. Under 10s: ${s.shortCalls}. Sentiment: ${s.sentiment.positive} positive, ${s.sentiment.neutral} neutral, ${s.sentiment.negative} negative.`;
    const action = `Next: ${s.nextAction.label} (follow up by ${s.followUpBy.slice(0, 10)})`;
    const notable = s.notableCalls.slice(0, 3).map((n) => `${n.reason}: ${n.summary ? n.summary.slice(0, 140) : `${n.seconds}s, ${n.outcome || 'unknown'}`}`);
    t.push(head, `  ${usage}`, `  ${detail}`, ...notable.map((n) => `  - ${n}`), `  ${action}`, `  ${siteUrl(env)}/admin/pilots/${d.pilot.id}`, '');
    h.push(
      `<h3>${escapeHtml(head)}</h3><p>${escapeHtml(usage)}<br>${escapeHtml(detail)}</p>`,
      notable.length ? `<ul>${notable.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : '',
      `<p><strong>${escapeHtml(action)}</strong> <a href="${escapeHtml(`${siteUrl(env)}/admin/pilots/${d.pilot.id}`)}">Open</a></p>`
    );
  }
  const topicLine = topics.length ? topics.map((x) => `${x.topic} (${x.count})`).join(', ') : 'not enough call summaries yet';
  t.push('What callers asked about across pilots (words in call summaries, count of calls mentioning each):', `  ${topicLine}`);
  h.push(`<h3>What callers asked about across pilots</h3><p>${escapeHtml(topicLine)}</p><p style="color:#888">Counts are calls whose summary mentions the word.</p>`);
  return { weekKey, subject: `Pilot digest: ${list.length} pilots, ${totalCalls} calls (week of ${weekKey})`, text: t.join('\n'), html: h.join(''), pilots: list.length, topics };
}

export interface WeeklyResult {
  dry: boolean;
  configured: boolean;
  skipped?: string;
  weekKey?: string;
  to?: string | null;
  subject?: string;
  text?: string;
  topics?: Digest['topics'];
  pilots: number;
  result?: 'sent' | 'failed' | 'already_sent' | 'would_send';
}

export async function runPilotWeeklyReport(db: Db, opts: { dry?: boolean; now?: Date; env?: Env; send?: SendFn } = {}): Promise<WeeklyResult> {
  const dry = !!opts.dry;
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const send = opts.send ?? defaultSendEmail;
  const configured = !!env.PILOT_ALERT_EMAIL && !!env.RESEND_API_KEY;
  const base: WeeklyResult = { dry, configured, pilots: 0 };

  const { rows, missingTable } = await loadPilots(db);
  if (missingTable) return { ...base, skipped: 'calldesk_pilots does not exist: migration 068 not applied' };
  const digest = buildWeeklyDigest(rows, now, env);
  const full: WeeklyResult = { ...base, weekKey: digest.weekKey, to: env.PILOT_ALERT_EMAIL || null, subject: digest.subject, text: digest.text, topics: digest.topics, pilots: digest.pilots };
  if (digest.pilots === 0) return { ...full, skipped: 'no pilots to report on' };
  if (dry) return { ...full, result: 'would_send' };
  if (!configured) return { ...full, skipped: 'PILOT_ALERT_EMAIL or RESEND_API_KEY not set: nothing sent, no marker written' };

  const key = `weekly:${digest.weekKey}`;
  const claim = await db.from('calldesk_pilot_events').insert({ pilot_id: null, event_key: key });
  if (claim.error) {
    if (isUniqueViolation(claim.error)) return { ...full, result: 'already_sent' };
    if (isMissingTable(claim.error)) return { ...full, skipped: 'calldesk_pilot_events does not exist: migration 068 not applied' };
    throw claim.error;
  }
  const res = await send({ to: env.PILOT_ALERT_EMAIL as string, subject: digest.subject, html: digest.html, text: digest.text });
  if (res.ok) return { ...full, result: 'sent' };
  await db.from('calldesk_pilot_events').delete().eq('event_key', key);
  return { ...full, result: 'failed' };
}
