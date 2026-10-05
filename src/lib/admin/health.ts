import { getSupabaseAdmin } from '@/lib/supabase';

export type Level = 'ok' | 'warn' | 'down' | 'off';
export interface Check { name: string; level: Level; detail: string; ms?: number }

const TIMEOUT_MS = 6000;

async function timed(name: string, fn: () => Promise<{ level: Level; detail: string }>): Promise<Check> {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out after 6 s')), TIMEOUT_MS)),
    ]);
    return { name, ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { name, level: 'down', detail: e instanceof Error ? e.message : 'failed', ms: Date.now() - t0 };
  }
}

async function ping(url: string): Promise<{ level: Level; detail: string }> {
  const res = await fetch(url, { cache: 'no-store', redirect: 'manual' });
  return res.status < 400 || res.status === 404 ? { level: 'ok', detail: `HTTP ${res.status}` } : { level: 'down', detail: `HTTP ${res.status}` };
}

// Whether an integration's credentials are present. Never reads or returns the values.
// `builtin`: variables the code falls back to a built-in default for (src/lib/failureReporter.ts), so a missing one is not a gap.
export const INTEGRATIONS: { name: string; vars: string[]; builtin?: string[] }[] = [
  { name: 'Twilio (calls, SMS)', vars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
  { name: 'Anthropic (agent brain)', vars: ['ANTHROPIC_API_KEY'] },
  { name: 'ElevenLabs (voices)', vars: ['ELEVENLABS_API_KEY'] },
  { name: 'Retell', vars: ['RETELL_API_KEY'] },
  { name: 'Stripe (billing)', vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  { name: 'Resend (email)', vars: ['RESEND_API_KEY'] },
  { name: 'Failure reporter', vars: ['FAILURE_REPORTER_URL', 'FAILURE_REPORTER_KEY'], builtin: ['FAILURE_REPORTER_URL', 'FAILURE_REPORTER_KEY'] },
  { name: 'PostHog read key (visitor list)', vars: ['POSTHOG_PERSONAL_API_KEY'] },
];

export function integrationStatus(env: Record<string, string | undefined> = process.env): Check[] {
  return INTEGRATIONS.map((i) => {
    const missing = i.vars.filter((v) => !env[v] && !i.builtin?.includes(v));
    if (missing.length) return { name: i.name, level: 'off' as Level, detail: `missing ${missing.join(', ')}` };
    const defaulted = i.vars.filter((v) => !env[v]);
    return { name: i.name, level: 'ok' as Level, detail: defaulted.length ? 'configured (built-in defaults)' : 'configured' };
  });
}

export async function runChecks(): Promise<Check[]> {
  const voiceUrl = process.env.CALL_LOOP_URL || process.env.CALL_LOOP_POC_BASE_URL;
  return Promise.all([
    timed('Database (Supabase)', async () => {
      const { error } = await getSupabaseAdmin().from('calldesk_tenants').select('id', { head: true, count: 'exact' }).limit(1);
      return error ? { level: 'down', detail: error.message } : { level: 'ok', detail: 'query ok' };
    }),
    timed('Voice server (call engine)', async () => (voiceUrl ? ping(voiceUrl) : { level: 'off', detail: 'CALL_LOOP_URL not set' })),
    timed('Public website', () => ping('https://calldesk.tech/')),
    timed('Sign-in', () => ping('https://calldesk.tech/auth/signin')),
  ]);
}

// Worst level wins; 'off' (not configured) never counts as an outage.
export function overall(checks: Check[]): Level {
  if (checks.some((c) => c.level === 'down')) return 'down';
  if (checks.some((c) => c.level === 'warn')) return 'warn';
  return 'ok';
}
