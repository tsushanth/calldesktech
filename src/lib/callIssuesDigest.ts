import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail as defaultSendEmail, type SendEmailParams, type SendEmailResult } from '@/lib/email';
import { escapeHtml } from '@/lib/outreach/emailHtml';
import { issuesFromAnalysis, hasIssues, type CallIssue } from '@/lib/callIssues';

// Daily email to PILOT_ALERT_EMAIL: how many real calls ran in the last 24 hours and which of them had a detected issue
// (see callIssues.ts) or failed outright. Quiet days send nothing. Nothing is sent without PILOT_ALERT_EMAIL and RESEND_API_KEY.

type Env = Record<string, string | undefined>;
export type SendFn = (p: SendEmailParams) => Promise<SendEmailResult>;

export interface DigestCall { id: string; tenant_id?: string | null; created_at: string; duration_seconds?: number | null; outcome?: string | null; analysis?: unknown; is_internal_test?: boolean | null }

export interface Digest {
  totalCalls: number;
  failedCalls: number;
  callsWithIssues: number;
  byCode: Record<string, number>;
  flagged: { id: string; tenantId: string | null; createdAt: string; reason: string }[];
}

const FAILED = new Set(['failed', 'error']);
const isFailed = (c: DigestCall) => FAILED.has(String(c.outcome ?? '').toLowerCase()) || (c.duration_seconds != null && c.duration_seconds < 3);

/** Pure: summarise one window of calls. Internal test calls are excluded everywhere. */
export function buildDigest(calls: DigestCall[]): Digest {
  const real = calls.filter((c) => !c.is_internal_test);
  const byCode: Record<string, number> = {};
  const flagged: Digest['flagged'] = [];
  let callsWithIssues = 0; let failedCalls = 0;
  for (const c of real) {
    const issues: CallIssue[] = hasIssues(c) ? issuesFromAnalysis(c.analysis) : [];
    const failed = isFailed(c);
    if (failed) failedCalls++;
    if (issues.length) { callsWithIssues++; for (const i of issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1; }
    if (issues.length || failed) flagged.push({ id: c.id, tenantId: c.tenant_id ?? null, createdAt: c.created_at, reason: [...issues.map((i) => i.code), ...(failed ? ['failed_or_very_short'] : [])].join(', ') });
  }
  return { totalCalls: real.length, failedCalls, callsWithIssues, byCode, flagged };
}

export const digestIsQuiet = (d: Digest) => d.flagged.length === 0;

export function renderDigest(d: Digest, appUrl = 'https://calldesk.tech'): { subject: string; html: string; text: string } {
  const subject = `Calldesk: ${d.callsWithIssues} call(s) with issues, ${d.failedCalls} failed, of ${d.totalCalls} in 24h`;
  const codes = Object.entries(d.byCode).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`);
  const rows = d.flagged.slice(0, 25);
  const text = [subject, '', codes.join('\n') || 'No issue codes.', '', ...rows.map((r) => `${r.createdAt}  ${r.id}  tenant ${r.tenantId ?? '-'}  ${r.reason}\n  ${appUrl}/dashboard/calls/${r.id}`), d.flagged.length > rows.length ? `...and ${d.flagged.length - rows.length} more` : ''].join('\n');
  const html = `<p><b>${escapeHtml(subject)}</b></p><p>${codes.map(escapeHtml).join('<br>') || 'No issue codes.'}</p><ul>${rows.map((r) => `<li>${escapeHtml(r.createdAt)} <a href="${appUrl}/dashboard/calls/${encodeURIComponent(r.id)}">${escapeHtml(r.id)}</a> tenant ${escapeHtml(r.tenantId ?? '-')}: ${escapeHtml(r.reason)}</li>`).join('')}</ul>${d.flagged.length > rows.length ? `<p>...and ${d.flagged.length - rows.length} more</p>` : ''}`;
  return { subject, html, text };
}

export async function runCallIssuesDigest(db: SupabaseClient, opts: { dry?: boolean; now?: Date; env?: Env; send?: SendFn } = {}) {
  const env = opts.env ?? process.env; const now = opts.now ?? new Date(); const send = opts.send ?? defaultSendEmail;
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await db.from('calldesk_call_logs').select('id, tenant_id, created_at, duration_seconds, outcome, analysis, is_internal_test').gte('created_at', since).order('created_at', { ascending: false }).limit(5000);
  if (error) throw error;
  const digest = buildDigest((data ?? []) as unknown as DigestCall[]);
  const to = env.PILOT_ALERT_EMAIL; const configured = !!to && !!env.RESEND_API_KEY;
  if (digestIsQuiet(digest)) return { configured, sent: false, quiet: true, digest };
  if (opts.dry || !configured) return { configured, sent: false, quiet: false, digest };
  const msg = renderDigest(digest, env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech');
  const r = await send({ to: to!, ...msg });
  return { configured, sent: r.ok, quiet: false, digest, error: r.error };
}
