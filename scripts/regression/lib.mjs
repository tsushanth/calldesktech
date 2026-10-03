// Helpers for the builder regression: publish a version through the real API, route the dedicated test number to
// it, have the AI "shopper" phone that number, then read back what the engine logged for the tenant.
// Everything here talks to production (that is where the call engine lives) as the throwaway user
// demo_e2e_regression, whose id starts with demo_ so every report treats it as internal.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { encode } from 'next-auth/jwt';

export const REG_USER_ID = 'demo_e2e_regression';
export const REG_TENANT_NAME = 'Regression tenant (do not use)';
export const REG_AGENT_NAME = 'Regression agent';
export const COST_PER_CALL_USD = 0.2; // rough: two AI sessions plus two Twilio legs for about 1.5 minutes
export const TOTAL_CALL_CAP = 60;     // lifetime cap tracked in out/.regression-calls-used; raise it on purpose

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

export function requireEnv(env, names) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`missing in .env: ${missing.join(', ')}`);
}

export function db(env) {
  const base = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} -> ${res.status} ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : [];
  };
  return { select: (p) => call('GET', p), insert: (t, row) => call('POST', t, row), update: (p, row) => call('PATCH', p, row) };
}

// A minimal API client that sends a session cookie minted for the throwaway user.
export async function apiClient(env, base = env.REGRESSION_API_BASE || 'https://calldesk.tech') {
  requireEnv(env, ['NEXTAUTH_SECRET']);
  const token = await encode({ token: { sub: REG_USER_ID, email: 'regression@calldesk.invalid', name: 'Regression' }, secret: env.NEXTAUTH_SECRET, maxAge: 3600 });
  const secure = base.startsWith('https:');
  const cookie = `${secure ? '__Secure-' : ''}next-auth.session-token=${token}`;
  return async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  };
}

// Find or create the tenant, agent and number row the scenarios run against.
export async function ensureFixtures(env, d, api) {
  let tenant = (await d.select(`calldesk_tenants?user_id=eq.${REG_USER_ID}&select=id`))[0];
  if (!tenant) tenant = (await d.insert('calldesk_tenants', { user_id: REG_USER_ID, name: REG_TENANT_NAME }))[0];
  let agent = (await d.select(`calldesk_agents?tenant_id=eq.${tenant.id}&name=eq.${encodeURIComponent(REG_AGENT_NAME)}&select=id`))[0];
  if (!agent) agent = (await api('POST', `/api/tenants/${tenant.id}/agents`, { name: REG_AGENT_NAME })).agent;
  const number = env.REGRESSION_NUMBER;
  let numRow = (await d.select(`calldesk_phone_numbers?number=eq.${encodeURIComponent(number)}&select=id,tenant_id`))[0];
  if (!numRow) numRow = (await d.insert('calldesk_phone_numbers', { tenant_id: tenant.id, number, source: 'purchased', label: 'Regression test number' }))[0];
  if (numRow.tenant_id !== tenant.id) throw new Error('the regression number belongs to a different tenant; refusing to re-route it');
  return { tenantId: tenant.id, agentId: agent.id, numberId: numRow.id, number };
}

export async function publishVersion(api, fx, scenario) {
  const v = scenario.version;
  const res = await api('POST', `/api/agents/${fx.agentId}/versions`, {
    flowName: `reg-${scenario.id}`, startNodeId: v.startNodeId, nodes: v.nodes, voiceEngine: 'poc', globalSettings: v.globalSettings || {},
  });
  return res.version.id;
}

export async function routeNumber(api, fx, versionId) {
  await api('POST', `/api/phone-numbers/${fx.numberId}/routing`, { direction: 'inbound', agentVersionId: versionId });
}

// Spend gate: every real call is counted in out/.regression-calls-used and refused past the caps.
const COUNTER = resolve(process.cwd(), 'out/.regression-calls-used');
export function callsUsed() { try { return Number(readFileSync(COUNTER, 'utf8').trim()) || 0; } catch { return 0; } }
export function recordCall() { mkdirSync(dirname(COUNTER), { recursive: true }); writeFileSync(COUNTER, String(callsUsed() + 1)); }
export function checkSpend({ wanted, maxCalls, used = callsUsed(), total = TOTAL_CALL_CAP }) {
  if (wanted > maxCalls) return { ok: false, reason: `this run wants ${wanted} calls but --max-calls is ${maxCalls}` };
  if (used + wanted > total) return { ok: false, reason: `${used} calls used of the lifetime cap ${total}; ${wanted} more would exceed it (edit TOTAL_CALL_CAP on purpose to raise it)` };
  return { ok: true, estimateUsd: Math.round(wanted * COST_PER_CALL_USD * 100) / 100 };
}

export async function placeShopperCall(env, { number, persona }) {
  const base = env.CALL_LOOP_POC_BASE_URL;
  const res = await fetch(`${base}/place-test-call`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.CALL_LOOP_POC_TEST_CALL_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ toNumber: number, shopper: true, record: false, persona }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.sid) throw new Error(`place-test-call failed (HTTP ${res.status}): ${JSON.stringify(j).slice(0, 200)}`);
  return j.sid;
}

export async function waitForCallEnd(env, sid, { timeoutMs = 240000 } = {}) {
  const base = env.CALL_LOOP_POC_BASE_URL;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await fetch(`${base}/call-status/${sid}`, { headers: { Authorization: `Bearer ${env.CALL_LOOP_POC_TEST_CALL_SECRET}` } }).then((r) => r.json()).catch(() => ({}));
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`call ${sid} did not finish within ${Math.round(timeoutMs / 1000)}s`);
}

// The tenant's own log of the inbound call (what the agent said and heard), newest first after `sinceIso`.
export async function fetchTenantCallLog(d, tenantId, sinceIso, { waitMs = 90000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    const rows = await d.select(`calldesk_call_logs?tenant_id=eq.${tenantId}&created_at=gte.${encodeURIComponent(sinceIso)}&select=id,transcript,duration_seconds,outcome,extracted_data,analysis,direction,created_at&order=created_at.desc&limit=1`);
    if (rows[0]?.transcript?.length) return rows[0];
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

// Normalise the stored transcript into [{speaker:'agent'|'caller', text}]. For the callee's own log, 'assistant' is the agent.
export function lines(log) {
  return (log?.transcript || []).map((t) => ({ speaker: t.role === 'assistant' ? 'agent' : 'caller', text: String(t.content ?? t.text ?? '').replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
}
export const agentText = (log) => lines(log).filter((l) => l.speaker === 'agent').map((l) => l.text).join(' ');
