// Shared helpers for the browser smoke tests. Plain node + playwright (already a dependency); no test runner.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { encode } from 'next-auth/jwt';
import { chromium } from 'playwright';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
// A user id starting with demo_ is treated as "ours" by every report (see src/lib/admin/internal.ts), so the
// throwaway tenant this test creates never shows up as customer activity.
export const E2E_USER_ID = 'demo_e2e_smoke';
export const E2E_EMAIL = 'e2e-smoke@calldesk.invalid';

export function loadEnv(file = resolve(process.cwd(), '.env')) {
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

export async function sessionCookie(env) {
  if (!env.NEXTAUTH_SECRET) throw new Error('NEXTAUTH_SECRET is not set');
  const token = await encode({ token: { sub: E2E_USER_ID, email: E2E_EMAIL, name: 'E2E Smoke' }, secret: env.NEXTAUTH_SECRET, maxAge: 3600 });
  const url = new URL(BASE_URL);
  const secure = url.protocol === 'https:';
  return { name: secure ? '__Secure-next-auth.session-token' : 'next-auth.session-token', value: token, domain: url.hostname, path: '/', httpOnly: true, secure, sameSite: 'Lax' };
}

// Minimal service-role REST client for set-up and clean-up only; the behavior under test goes through the UI.
export function db(env) {
  const base = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : [];
  };
  return {
    select: (path) => call('GET', path),
    insert: (table, row) => call('POST', table, row),
    remove: (path) => call('DELETE', path),
  };
}

export async function launch() {
  const executablePath = process.env.E2E_CHROME || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  // E2E_ANALYTICS=1 lets our own PostHog capture the run: posthog-js drops events from browsers that look automated
// (navigator.webdriver, HeadlessChrome), which is right for visitors but hides the telemetry we want to verify.
const args = process.env.E2E_ANALYTICS ? ['--disable-blink-features=AutomationControlled'] : [];
  return chromium.launch({ executablePath, headless: process.env.E2E_HEADED ? false : true, args });
}

export const CONTEXT_OPTIONS = process.env.E2E_ANALYTICS
  ? { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36' }
  : {};

export function reporter() {
  const results = [];
  return {
    async step(name, fn) {
      const t0 = Date.now();
      try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ok   ${name}`); }
      catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }); console.log(`  FAIL ${name}\n       ${String(e instanceof Error ? e.message : e).split('\n')[0]}`); throw e; }
    },
    summary: () => results,
  };
}
