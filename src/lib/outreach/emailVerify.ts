import type { SupabaseClient } from '@supabase/supabase-js';

// Mailbox-level verification, run right before a send. The DNS check in mxCheck.ts only proves the
// DOMAIN can receive mail; it cannot tell that info@somebusiness.com does not exist, which is what
// produces hard bounces. A verification API asks the recipient's mail server (and its own data) about
// the specific mailbox.
//
// Configuration (all optional; with no key the step is skipped and sending behaves as before):
//   EMAIL_VERIFY_API_KEY        provider API key
//   EMAIL_VERIFY_PROVIDER       'millionverifier' (default) | 'zerobounce'
//   EMAIL_VERIFY_BLOCK_RISKY    'on' also blocks catch-all domains (default: catch-all is sent)
//
// Fails OPEN: a provider error, timeout or exhausted quota returns 'unknown' and the send proceeds,
// because a verification outage must never silently stop outreach. The auto-pause on bounces remains
// the backstop.

export type Verdict = 'deliverable' | 'undeliverable' | 'risky' | 'unknown' | 'skipped';
export interface VerifyResult { verdict: Verdict; provider: string; detail?: string }

const CACHE_DAYS = 30;
const DEFINITIVE: Verdict[] = ['deliverable', 'undeliverable', 'risky'];

interface Opts { fetchImpl?: typeof fetch; timeoutMs?: number; env?: Record<string, string | undefined> }

async function getJson(url: string, opts: Opts): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

// ZeroBounce's do_not_mail bucket includes role-based addresses (info@, contact@), which are exactly
// the addresses this pipeline targets and are usually perfectly deliverable. Only the sub-statuses
// that mean "do not send" are treated as undeliverable.
const ZB_ROLE_OK = new Set(['role_based', 'role_based_catch_all']);

export function mapMillionVerifier(j: Record<string, unknown>): VerifyResult {
  const provider = 'millionverifier';
  if (j.error) return { verdict: 'unknown', provider, detail: `provider error: ${String(j.error).slice(0, 80)}` };
  const result = String(j.result ?? '').toLowerCase();
  if (result === 'ok') return { verdict: 'deliverable', provider };
  if (result === 'invalid' || result === 'disposable') return { verdict: 'undeliverable', provider, detail: String(j.subresult || result) };
  if (result === 'catch_all') return { verdict: 'risky', provider, detail: 'catch-all domain' };
  return { verdict: 'unknown', provider, detail: result || 'no result' };
}

export function mapZeroBounce(j: Record<string, unknown>): VerifyResult {
  const provider = 'zerobounce';
  if (j.error) return { verdict: 'unknown', provider, detail: `provider error: ${String(j.error).slice(0, 80)}` };
  const status = String(j.status ?? '').toLowerCase();
  const sub = String(j.sub_status ?? '').toLowerCase();
  if (status === 'valid') return { verdict: 'deliverable', provider };
  if (status === 'invalid' || status === 'spamtrap' || status === 'abuse') return { verdict: 'undeliverable', provider, detail: sub || status };
  if (status === 'do_not_mail') return ZB_ROLE_OK.has(sub) ? { verdict: 'risky', provider, detail: sub } : { verdict: 'undeliverable', provider, detail: sub || status };
  if (status === 'catch-all') return { verdict: 'risky', provider, detail: 'catch-all domain' };
  return { verdict: 'unknown', provider, detail: status || 'no status' };
}

export async function verifyMailbox(email: string, opts: Opts = {}): Promise<VerifyResult> {
  const env = opts.env ?? process.env;
  const key = (env.EMAIL_VERIFY_API_KEY || '').trim();
  const provider = (env.EMAIL_VERIFY_PROVIDER || 'millionverifier').trim().toLowerCase();
  if (!key) return { verdict: 'skipped', provider, detail: 'EMAIL_VERIFY_API_KEY not set' };
  try {
    if (provider === 'zerobounce') {
      return mapZeroBounce(await getJson(`https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`, opts));
    }
    if (provider === 'millionverifier') {
      return mapMillionVerifier(await getJson(`https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&timeout=20`, opts));
    }
    return { verdict: 'unknown', provider, detail: `unknown provider "${provider}"` };
  } catch (err) {
    return { verdict: 'unknown', provider, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Whether a verdict should stop the send. Risky (catch-all) only blocks when EMAIL_VERIFY_BLOCK_RISKY=on. */
export function shouldBlock(v: VerifyResult, env: Record<string, string | undefined> = process.env): boolean {
  return v.verdict === 'undeliverable' || (v.verdict === 'risky' && env.EMAIL_VERIFY_BLOCK_RISKY === 'on');
}

interface CachedVerification { email: string; verdict: Verdict; provider: string; at: string; detail?: string }

/**
 * Verifies a lead's email, reusing a definitive result from the last 30 days (credits are per call, so
 * the same address is never paid for twice) and recording the new result on the lead's signals.
 */
export async function verifyLeadEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  lead: { id: string; signals?: Record<string, unknown> | null } | null,
  email: string,
  opts: Opts = {},
): Promise<VerifyResult & { cached?: boolean }> {
  const addr = email.trim().toLowerCase();
  const cached = lead?.signals?.emailVerification as CachedVerification | undefined;
  if (cached && cached.email === addr && DEFINITIVE.includes(cached.verdict) && Date.now() - new Date(cached.at).getTime() < CACHE_DAYS * 864e5) {
    return { verdict: cached.verdict, provider: cached.provider, detail: cached.detail, cached: true };
  }
  const result = await verifyMailbox(addr, opts);
  if (lead && DEFINITIVE.includes(result.verdict)) {
    const record: CachedVerification = { email: addr, verdict: result.verdict, provider: result.provider, at: new Date().toISOString(), detail: result.detail };
    await supabase.from('calldesk_outreach_leads').update({ signals: { ...(lead.signals ?? {}), emailVerification: record } }).eq('id', lead.id);
  }
  return result;
}
