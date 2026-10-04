#!/usr/bin/env node
// Browser smoke test for the per-plan "Start with Lite / Standard / Pro" flow, from the pricing page into the builder.
//
//   BASE_URL=https://calldesk.tech node e2e/plan-flow-smoke.mjs     # needs .env (Supabase + NEXTAUTH_SECRET) in the cwd or the environment
//   npm run e2e:plan
//
// What it proves:
//   1. /pricing (signed out) shows one "Start with <Plan>" button per plan, and the button remembers the chosen plan.
//   2. /pricing?plan=lite remembers the plan too, and ignores junk values.
//   3. A signed-in user who picked Lite lands in the builder of a NEW agent with Lite preselected, the voice-quality checkbox
//      UNTICKED and Publish disabled; ticking it enables Publish (Lite is never accepted on the customer's behalf).
//   4. Publishing stores tier lite on Piper with the Lite voice, and the remembered plan is cleared afterwards.
// It never starts checkout, never places a call, never touches Stripe, Twilio, Telnyx or Retell. All rows belong to the throwaway
// user demo_e2e_smoke (internal everywhere) and are deleted at the end, pass or fail.
import { BASE_URL, E2E_USER_ID, CONTEXT_OPTIONS, loadEnv, sessionCookie, db, launch, reporter } from './lib.mjs';

const env = loadEnv();
const d = db(env);
const r = reporter();
let tenantId = null;
let agentId = null;
let failed = false;

async function cleanup() {
  try {
    if (agentId) {
      for (const t of ['calldesk_agent_environments', 'calldesk_agent_versions']) await d.remove(`${t}?agent_id=eq.${agentId}`).catch(() => {});
      await d.remove(`calldesk_agents?id=eq.${agentId}`).catch(() => {});
    }
    if (tenantId) await d.remove(`calldesk_tenants?id=eq.${tenantId}`).catch(() => {});
  } catch (e) { console.log('cleanup warning:', e.message); }
}

const readPlan = (page) => page.evaluate(() => { try { return window.localStorage.getItem('calldesk_plan'); } catch { return 'storage-blocked'; } });

const browser = await launch();
try {
  // 1 + 2: signed out
  const anon = await browser.newContext({ viewport: { width: 1300, height: 900 }, ...CONTEXT_OPTIONS });
  const apage = await anon.newPage();

  await r.step('/pricing shows a Start with button for each of the three plans', async () => {
    await apage.goto(`${BASE_URL}/pricing`, { waitUntil: 'networkidle' });
    for (const plan of ['Lite', 'Standard', 'Pro']) {
      const n = await apage.getByRole('button', { name: new RegExp(`Start with ${plan}`) }).count();
      if (n < 1) throw new Error(`no "Start with ${plan}" button`);
    }
    const text = (await apage.locator('body').innerText()).replace(/\s+/g, ' ');
    if (/Lite[^.]{0,30}coming soon/i.test(text)) throw new Error('Lite is still marked "coming soon"');
    if (/noticeably/i.test(text)) throw new Error('the old "noticeably lower quality" wording is still on the page');
  });

  await r.step('?plan=lite remembers Lite; a junk plan is ignored', async () => {
    await apage.goto(`${BASE_URL}/pricing?plan=lite`, { waitUntil: 'networkidle' });
    await apage.waitForTimeout(500);
    if ((await readPlan(apage)) !== 'lite') throw new Error(`stored plan is ${await readPlan(apage)}`);
    await apage.evaluate(() => window.localStorage.removeItem('calldesk_plan'));
    await apage.goto(`${BASE_URL}/pricing?plan=enterprise%27%3Balert(1)`, { waitUntil: 'networkidle' });
    await apage.waitForTimeout(500);
    if ((await readPlan(apage)) !== null) throw new Error(`a junk plan was stored: ${await readPlan(apage)}`);
  });

  await r.step('clicking Start with Lite remembers Lite (signed out, before the sign-in redirect)', async () => {
    await apage.goto(`${BASE_URL}/pricing`, { waitUntil: 'networkidle' });
    await apage.evaluate(() => window.localStorage.removeItem('calldesk_plan'));
    // Capture what was stored at click time: the click then navigates to sign-in, so read it from a storage hook.
    await apage.evaluate(() => {
      window.__plan = null;
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'calldesk_plan') window.__plan = v; return orig.call(this, k, v); };
    });
    await apage.getByRole('button', { name: /Start with Lite/ }).first().click();
    const stored = await apage.evaluate(() => window.__plan).catch(() => null);
    const after = await readPlan(apage).catch(() => null);
    if (stored !== 'lite' && after !== 'lite') throw new Error(`plan not remembered (hook=${stored}, storage=${after})`);
  });
  await anon.close();

  // 3 + 4: signed in
  await r.step('set up throwaway tenant', async () => {
    const old = await d.select(`calldesk_tenants?user_id=eq.${E2E_USER_ID}&select=id`);
    for (const t of old) {
      const ags = await d.select(`calldesk_agents?tenant_id=eq.${t.id}&select=id`);
      for (const a of ags) { for (const tb of ['calldesk_agent_environments', 'calldesk_agent_versions']) await d.remove(`${tb}?agent_id=eq.${a.id}`).catch(() => {}); await d.remove(`calldesk_agents?id=eq.${a.id}`).catch(() => {}); }
      await d.remove(`calldesk_tenants?id=eq.${t.id}`).catch(() => {});
    }
    tenantId = (await d.insert('calldesk_tenants', { user_id: E2E_USER_ID, name: 'E2E Plan Flow (do not use)' }))[0].id;
  });

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ...CONTEXT_OPTIONS });
  await ctx.addCookies([await sessionCookie(env)]);
  await ctx.addInitScript(() => { try { window.localStorage.setItem('calldesk_plan', 'lite'); } catch { /* ignore */ } });
  const page = await ctx.newPage();

  await r.step('a new voice agent opens in the builder', async () => {
    await page.goto(`${BASE_URL}/dashboard/agents`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Create an Agent/ }).click();
    await page.getByRole('button', { name: /^Voice Agent/ }).click();
    await page.waitForURL(/\/dashboard\/agents\/[0-9a-f-]{36}/, { timeout: 20000 });
    agentId = page.url().match(/agents\/([0-9a-f-]{36})/)[1];
    await page.getByRole('button', { name: /^Single prompt/ }).click();
  });

  await r.step('Lite is preselected, its checkbox is UNTICKED and Publish is disabled', async () => {
    await page.locator('[data-testid="tier-picker"]').waitFor({ timeout: 15000 });
    const lite = page.locator('input[name="pricing-tier"][value="lite"]');
    if (!(await lite.isChecked())) throw new Error('Lite is not preselected');
    const box = page.locator('[data-testid="lower-quality-accept"] input[type="checkbox"]');
    await box.waitFor({ timeout: 5000 });
    if (await box.isChecked()) throw new Error('the voice-quality checkbox was ticked for the customer');
    if (!(await page.getByRole('button', { name: /^Publish$/ }).isDisabled())) throw new Error('Publish is enabled before accepting');
  });

  await r.step('ticking the checkbox enables Publish', async () => {
    await page.locator('[data-testid="lower-quality-accept"] input[type="checkbox"]').check();
    if (await page.getByRole('button', { name: /^Publish$/ }).isDisabled()) throw new Error('Publish is still disabled after accepting');
  });

  await r.step('Publish stores tier lite on Piper with the Lite voice, and the remembered plan is cleared', async () => {
    await page.locator('label', { hasText: 'Prompt' }).first().locator('xpath=following::*[self::input or self::textarea or self::select][1]').fill('You are the receptionist for E2E Plan Flow. Greet the caller and take a message.');
    await page.locator('label', { hasText: 'Version name' }).first().locator('xpath=following::*[self::input or self::textarea or self::select][1]').fill('e2e-plan-v1');
    await page.getByRole('button', { name: /^Publish$/ }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Publishing'), null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const v = await d.select(`calldesk_agent_versions?agent_id=eq.${agentId}&select=tier,tts_backend,voice_id,llm_model&order=version_number.desc&limit=1`);
    if (!v.length) throw new Error(`no version saved (page: ${(await page.locator('body').innerText()).match(/(error|failed|required|invalid)[^\n]{0,120}/i)?.[0] ?? 'nothing obvious'})`);
    const row = v[0];
    if (row.tier !== 'lite') throw new Error(`tier is ${row.tier}`);
    if (row.tts_backend !== 'piper') throw new Error(`tts_backend is ${row.tts_backend}`);
    if (row.voice_id !== 'custom:en-us-warm-f') throw new Error(`voice_id is ${row.voice_id}`);
    if ((await readPlan(page)) === 'lite') throw new Error('the remembered plan was not cleared after publishing');
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
