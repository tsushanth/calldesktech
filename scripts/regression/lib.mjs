// Helpers for the builder regression: publish a version through the real API, route the dedicated test number to
// it, have the AI "shopper" phone that number, then read back what the engine logged for the tenant.
// Everything here talks to production (that is where the call engine lives) as the throwaway user
// demo_e2e_regression, whose id starts with demo_ so every report treats it as internal.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { encode } from 'next-auth/jwt';

export const REG_USER_ID = 'demo_e2e_regression';
export const REG_TENANT_NAME = 'Regression tenant (do not use)';
export const REG_AGENT_NAME = 'Regression agent';
export const REG_AGENT_B_NAME = 'Regression agent B';
export const COST_PER_CALL_USD = 0.2; // rough: two AI sessions plus two Twilio legs for about 1.5 minutes
export const TOTAL_CALL_CAP = 80;     // lifetime cap tracked in ~/.calldesk-regression-calls-used; raise it on purpose

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
  // A second agent in the same tenant: the target of agent-to-agent transfers.
  let agentB = (await d.select(`calldesk_agents?tenant_id=eq.${tenant.id}&name=eq.${encodeURIComponent(REG_AGENT_B_NAME)}&select=id`))[0];
  if (!agentB) agentB = (await api('POST', `/api/tenants/${tenant.id}/agents`, { name: REG_AGENT_B_NAME })).agent;
  // Optional extra numbers: B is registered to the same tenant (transfer target answered by the engine); C is only a
  // dial target whose Twilio voice webhook is the receiver Worker (scripted IVR / voicemail / silent callee).
  const extra = {};
  if (env.REGRESSION_NUMBER_C) extra.REGRESSION_NUMBER_C = { number: env.REGRESSION_NUMBER_C }; // answered by the receiver Worker, not by the engine
  for (const [key, label] of [['REGRESSION_NUMBER_B', 'Regression transfer target']]) {
    const n = env[key];
    if (!n) continue;
    let row = (await d.select(`calldesk_phone_numbers?number=eq.${encodeURIComponent(n)}&select=id,tenant_id`))[0];
    if (!row) row = (await d.insert('calldesk_phone_numbers', { tenant_id: tenant.id, number: n, source: 'purchased', label }))[0];
    if (row.tenant_id !== tenant.id) throw new Error(`${key} belongs to a different tenant; refusing to re-route it`);
    extra[key] = { id: row.id, number: n };
  }
  return { tenantId: tenant.id, agentId: agent.id, agentBId: agentB.id, numberId: numRow.id, number, extra };
}

// REGRESSION_TIER (set by run.mjs --tier) publishes every version on that tier; 'lite' also needs acceptLowerQuality.
export async function publishVersion(api, fx, scenario, { agentId = fx.agentId, version = scenario.version, name = `reg-${scenario.id}` } = {}) {
  const tier = process.env.REGRESSION_TIER;
  const res = await api('POST', `/api/agents/${agentId}/versions`, {
    flowName: name, startNodeId: version.startNodeId, nodes: version.nodes, voiceEngine: 'poc', globalSettings: version.globalSettings || {},
    ...(process.env.REGRESSION_VOICE ? { voiceId: process.env.REGRESSION_VOICE } : {}),
    ...(tier ? { tier, ...(tier === 'lite' ? { acceptLowerQuality: true } : {}) } : {}),
  });
  return res.version.id;
}

export async function routeNumber(api, numberId, versionId, direction = 'inbound') {
  await api('POST', `/api/phone-numbers/${numberId}/routing`, { direction, agentVersionId: versionId });
}

// Spend gate: every real call is counted in ~/.calldesk-regression-calls-used (outside any worktree, so it survives
// checkouts) and refused past the caps. REGRESSION_COUNTER_FILE overrides the location.
const COUNTER = process.env.REGRESSION_COUNTER_FILE || resolve(homedir(), '.calldesk-regression-calls-used');
export function callsUsed() { try { return Number(readFileSync(COUNTER, 'utf8').trim()) || 0; } catch { return 0; } }
export function recordCall() { mkdirSync(dirname(COUNTER), { recursive: true }); writeFileSync(COUNTER, String(callsUsed() + 1)); }
export function checkSpend({ wanted, maxCalls, used = callsUsed(), total = TOTAL_CALL_CAP }) {
  if (wanted > maxCalls) return { ok: false, reason: `this run wants ${wanted} calls but --max-calls is ${maxCalls}` };
  if (used + wanted > total) return { ok: false, reason: `${used} calls used of the lifetime cap ${total}; ${wanted} more would exceed it (edit TOTAL_CALL_CAP on purpose to raise it)` };
  return { ok: true, estimateUsd: Math.round(wanted * COST_PER_CALL_USD * 100) / 100 };
}

export async function placeShopperCall(env, { number, persona, language, speakFirst }) {
  const base = env.CALL_LOOP_POC_BASE_URL;
  const res = await fetch(`${base}/place-test-call`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.CALL_LOOP_POC_TEST_CALL_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ toNumber: number, shopper: true, record: false, persona, ...(language ? { language } : {}), ...(speakFirst ? { speakFirst: true } : {}) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.sid) throw new Error(`place-test-call failed (HTTP ${res.status}): ${JSON.stringify(j).slice(0, 200)}`);
  return j.sid;
}

// Outbound call from the tenant's own number (routeAs) to `to`, handled by that number's outbound version.
export async function placeOutboundCall(env, { from, to }) {
  const res = await fetch(`${env.CALL_LOOP_POC_BASE_URL}/place-test-call`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.CALL_LOOP_POC_TEST_CALL_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ toNumber: to, routeAs: from, direction: 'outbound', record: false }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.sid) throw new Error(`outbound place-test-call failed (HTTP ${res.status}): ${JSON.stringify(j).slice(0, 200)}`);
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
// The shopper's own call is logged under the tenant too (its to_number is the tenant's number), so every call
// leaves a pair of rows: the business side and the shopper's side. `excludeSid` drops the shopper's row (its
// retell_call_id is the SID place-test-call returned), leaving only what the business heard and said.
export async function fetchTenantCallLog(d, tenantId, sinceIso, { waitMs = 90000, excludeSid = null } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    const rows = await d.select(`calldesk_call_logs?tenant_id=eq.${tenantId}&created_at=gte.${encodeURIComponent(sinceIso)}&select=id,retell_call_id,transcript,duration_seconds,outcome,extracted_data,analysis,direction,to_number,created_at&order=created_at.asc&limit=10`);
    const mine = rows.filter((r) => r.retell_call_id !== excludeSid && r.transcript?.length);
    if (mine.length) return mine[0];
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

// Every call the tenant logged since `sinceIso` (oldest first). Used when one scenario produces several calls
// (for example a transfer: the original call plus the leg that reaches the target).
export async function fetchTenantLogsSince(d, tenantId, sinceIso, { settleMs = 25000, excludeSid = null } = {}) {
  await new Promise((r) => setTimeout(r, settleMs));
  const rows = await d.select(`calldesk_call_logs?tenant_id=eq.${tenantId}&created_at=gte.${encodeURIComponent(sinceIso)}&select=id,retell_call_id,transcript,duration_seconds,outcome,extracted_data,analysis,direction,to_number,created_at&order=created_at.asc&limit=12`);
  return rows.filter((r) => r.retell_call_id !== excludeSid);
}

// Normalise the stored transcript into [{speaker:'agent'|'caller', text}]. For the callee's own log, 'assistant' is the agent.
export function lines(log) {
  return (log?.transcript || []).map((t) => ({ speaker: t.role === 'assistant' ? 'agent' : 'caller', text: String(t.content ?? t.text ?? '').replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
}
export const agentText = (log) => lines(log).filter((l) => l.speaker === 'agent').map((l) => l.text).join(' ');

// Client for the test receiver (scripts/regression/receiver): hands out URLs for one run id and reads back what the
// engine sent to them. Needs REGRESSION_RECEIVER_URL and REGRESSION_RECEIVER_SECRET in .env.
export function makeReceiver(env, runId) {
  const base = env.REGRESSION_RECEIVER_URL;
  const secret = env.REGRESSION_RECEIVER_SECRET;
  if (!base || !secret) throw new Error('REGRESSION_RECEIVER_URL / REGRESSION_RECEIVER_SECRET are not set in .env (see scripts/regression/receiver/README.md)');
  const headers = { 'X-Reg-Secret': secret };
  return {
    runId,
    url: (kind, query = '') => `${base}/${kind}/${runId}${query}`,
    async events({ waitMs = 8000 } = {}) {
      const t0 = Date.now();
      let out = [];
      do {
        const res = await fetch(`${base}/events/${runId}`, { headers });
        if (res.ok) out = (await res.json()).events || [];
        if (out.length) break;
        await new Promise((r) => setTimeout(r, 2000));
      } while (Date.now() - t0 < waitMs);
      return out;
    },
    // Choose what the receiver NUMBER does for the next call (ivr | voicemail | silent); events then land under this run.
    async setMode(mode) {
      const res = await fetch(`${base}/current`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ run: runId, mode }) });
      if (!res.ok) throw new Error(`receiver /current -> ${res.status}`);
    },
    async clear() { await fetch(`${base}/events/${runId}`, { method: 'DELETE', headers }).catch(() => {}); },
  };
}
export const newRunId = () => `r-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`.slice(0, 40);


// The engine's current Fly release (e.g. "v214"), or null when flyctl is missing or fails. A deploy or secret change replaces the machine and
// drops calls in flight, so a run that sees the release change is inconclusive, not a product failure (2026-10-03: language-switch "failed" 3 s
// after release v211).
export function engineRelease(app = process.env.REGRESSION_ENGINE_APP || 'call-loop-poc') {
  try {
    const out = execFileSync('flyctl', ['releases', '-a', app, '--json'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
    const rel = JSON.parse(out);
    const v = Array.isArray(rel) ? rel[0]?.Version ?? rel[0]?.version : null;
    return v == null ? null : `v${v}`;
  } catch { return null; }
}

// Called when no call log with a transcript appeared. A row that exists but is shorter than 5 s with no transcript means the call was cut
// off mid-flight (engine restart or deploy), which is worth a retry; no row at all means the call never reached the engine.
export async function diagnoseMissingLog(d, tenantId, sinceIso) {
  const rows = await d.select(`calldesk_call_logs?tenant_id=eq.${tenantId}&created_at=gte.${encodeURIComponent(sinceIso)}&select=duration_seconds,transcript&limit=10`);
  const cutOff = rows.some((r) => (r.duration_seconds ?? 0) < 5 && !(r.transcript?.length));
  if (cutOff) return { retryable: true, message: 'call ended in under 5 s with no transcript (engine restart or deploy mid-call?)' };
  return { retryable: false, message: 'no call log appeared for the test tenant (did the call reach the engine?)' };
}
