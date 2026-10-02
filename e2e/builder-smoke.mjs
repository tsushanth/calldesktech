#!/usr/bin/env node
// Browser smoke test for the agent builder, UI to database and back.
//
//   npm run build && PORT=3100 npm start        # in one terminal (needs .env with Supabase + NEXTAUTH_SECRET)
//   node e2e/builder-smoke.mjs                  # in another; BASE_URL defaults to http://localhost:3100
//
// What it proves: a signed-in user can create a voice agent, fill the single-prompt builder, Publish, and the
// values they typed are what got stored AND what the builder shows after a reload. It does NOT place a call or
// touch Twilio/Retell (default 'poc' engine, database only). All rows belong to the throwaway user demo_e2e_smoke
// (treated as internal everywhere) and are deleted at the end, pass or fail.
import { BASE_URL, E2E_USER_ID, loadEnv, sessionCookie, db, launch, reporter } from './lib.mjs';

const env = loadEnv();
const d = db(env);
const r = reporter();
const MAX_SECONDS = '321';
const SILENCE_SECONDS = '17';
const FILLERS = 'Hold on, One sec';
const PROMPT = 'You are the receptionist for E2E Smoke Plumbing. Greet the caller, ask what they need, and take a message.';
const VERSION = 'e2e-smoke-v1';

let tenantId = null;
let agentId = null;
let failed = false;

// The labels in the builder are plain text next to the control, not <label for>, so find the control that follows.
const field = (page, label) => page.locator('label', { hasText: label }).first().locator('xpath=following::*[self::input or self::textarea or self::select][1]');

async function cleanup() {
  try {
    if (agentId) {
      for (const t of ['calldesk_agent_environments', 'calldesk_agent_versions']) await d.remove(`${t}?agent_id=eq.${agentId}`).catch(() => {});
      await d.remove(`calldesk_agents?id=eq.${agentId}`).catch(() => {});
    }
    if (tenantId) await d.remove(`calldesk_tenants?id=eq.${tenantId}`).catch(() => {});
  } catch (e) { console.log('cleanup warning:', e.message); }
}

const browser = await launch();
try {
  await r.step('set up throwaway tenant', async () => {
    const old = await d.select(`calldesk_tenants?user_id=eq.${E2E_USER_ID}&select=id`);
    for (const t of old) { // leftovers from an interrupted run
      const ags = await d.select(`calldesk_agents?tenant_id=eq.${t.id}&select=id`);
      for (const a of ags) { for (const tb of ['calldesk_agent_environments', 'calldesk_agent_versions']) await d.remove(`${tb}?agent_id=eq.${a.id}`).catch(() => {}); await d.remove(`calldesk_agents?id=eq.${a.id}`).catch(() => {}); }
      await d.remove(`calldesk_tenants?id=eq.${t.id}`).catch(() => {});
    }
    tenantId = (await d.insert('calldesk_tenants', { user_id: E2E_USER_ID, name: 'E2E Smoke (do not use)' }))[0].id;
  });

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addCookies([await sessionCookie(env)]);
  const page = await ctx.newPage();
  const badResponses = [];
  const pageErrors = [];
  page.on('response', (res) => { if (res.url().includes('/api/') && res.status() >= 400) badResponses.push(`${res.status()} ${res.url().replace(BASE_URL, '')}`); });
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 160)));

  await r.step('agents page loads for a signed-in user', async () => {
    await page.goto(`${BASE_URL}/dashboard/agents`, { waitUntil: 'networkidle' });
    if (!page.url().includes('/dashboard/agents')) throw new Error(`redirected to ${page.url()}`);
    await page.getByRole('button', { name: /Create an Agent/ }).waitFor({ timeout: 15000 });
  });

  await r.step('create a voice agent and land in the builder', async () => {
    await page.getByRole('button', { name: /Create an Agent/ }).click();
    await page.getByRole('button', { name: /^Voice Agent/ }).click();
    await page.waitForURL(/\/dashboard\/agents\/[0-9a-f-]{36}/, { timeout: 20000 });
    agentId = page.url().match(/agents\/([0-9a-f-]{36})/)[1];
    const rows = await d.select(`calldesk_agents?id=eq.${agentId}&select=id,tenant_id`);
    if (rows.length !== 1) throw new Error('agent row was not created in the database');
  });

  await r.step('fill the single-prompt builder', async () => {
    await page.getByRole('button', { name: /^Single prompt/ }).click();
    await field(page, 'Prompt').fill(PROMPT);
    await field(page, 'Version name').fill(VERSION);
    await field(page, 'Max call duration').fill(MAX_SECONDS);
    await field(page, 'End call after silence').fill(SILENCE_SECONDS);
    await field(page, 'Filler words').fill(FILLERS);
  });

  await r.step('Publish succeeds with no error banner', async () => {
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Publishing'), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const versions = await d.select(`calldesk_agent_versions?agent_id=eq.${agentId}&select=id,version_number,flow_id,voice_engine`);
    if (versions.length < 1) throw new Error(`no version was saved (page said: ${(await page.locator('body').innerText()).match(/(error|failed|required|invalid)[^\n]{0,100}/i)?.[0] ?? 'nothing obvious'})`);
  });

  let stored = '';
  await r.step('what was typed is what got stored', async () => {
    const versions = await d.select(`calldesk_agent_versions?agent_id=eq.${agentId}&select=flow_id&order=version_number.desc&limit=1`);
    const res = await page.request.get(`${BASE_URL}/api/flows/${versions[0].flow_id}`);
    if (!res.ok()) throw new Error(`GET flow -> ${res.status()}`);
    stored = JSON.stringify(await res.json());
    const missing = [['prompt text', 'E2E Smoke Plumbing'], ['max call duration', MAX_SECONDS], ['silence seconds', SILENCE_SECONDS], ['filler words', 'Hold on']].filter(([, needle]) => !stored.includes(needle));
    if (missing.length) throw new Error(`not found in the saved flow: ${missing.map(([n]) => n).join(', ')}`);
  });

  await r.step('reloading the builder shows the saved values', async () => {
    await page.goto(`${BASE_URL}/dashboard/agents/${agentId}`, { waitUntil: 'networkidle' });
    await field(page, 'Max call duration').waitFor({ timeout: 15000 });
    const got = { max: await field(page, 'Max call duration').inputValue(), silence: await field(page, 'End call after silence').inputValue(), fillers: await field(page, 'Filler words').inputValue() };
    const wrong = [];
    if (got.max !== MAX_SECONDS) wrong.push(`max call duration shows "${got.max}"`);
    if (got.silence !== SILENCE_SECONDS) wrong.push(`silence shows "${got.silence}"`);
    if (!got.fillers.includes('Hold on')) wrong.push(`filler words show "${got.fillers}"`);
    if (wrong.length) throw new Error(wrong.join('; '));
  });

  await r.step('no failing API calls or uncaught page errors during the run', async () => {
    const real = badResponses.filter((b) => !/\/api\/(auth|tenants\/[^/]+\/(voices|phone-numbers))/.test(b));
    if (real.length || pageErrors.length) throw new Error([...real.map((b) => `HTTP ${b}`), ...pageErrors.map((e) => `page error: ${e}`)].slice(0, 4).join(' | '));
  });
} catch {
  failed = true;
} finally {
  await browser.close();
  await cleanup();
}
const res = r.summary();
console.log(`\n${res.filter((x) => x.ok).length}/${res.length} steps passed${failed ? ' (stopped at first failure)' : ''}`);
process.exit(failed ? 1 : 0);
