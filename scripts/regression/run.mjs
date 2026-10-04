#!/usr/bin/env node
// Builder regression runner: publish a version, route the dedicated test number to it, have the AI shopper phone it,
// check what the engine logged. Real calls cost money (about $0.20 each), so the default is a DRY RUN.
//
//   node scripts/regression/run.mjs                                   # dry run: lists scenarios, checks config, shows the spend
//   node scripts/regression/run.mjs --scenario handbook-secret --place-calls
//   node scripts/regression/run.mjs --place-calls --max-calls 6       # run every scenario (refuses if it would exceed the cap)
//   node scripts/regression/run.mjs --tier standard --routing expert_backup --place-calls   # publish with the Expert backup extra (+1.5 cents a minute)
//
// Needs in .env: REGRESSION_NUMBER, CALL_LOOP_POC_BASE_URL, CALL_LOOP_POC_TEST_CALL_SECRET, NEXTAUTH_SECRET,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Secret values are never printed. Results go to out/regression/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, requireEnv, db, apiClient, ensureFixtures, publishVersion, routeNumber, checkSpend, recordCall, callsUsed, TOTAL_CALL_CAP, engineRelease, diagnoseMissingLog, placeShopperCall, placeOutboundCall, waitForCallEnd, fetchTenantCallLog, fetchTenantLogsSince, lines, makeReceiver, newRunId } from './lib.mjs';
import { pick } from './scenarios.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, dflt) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : dflt; };
const place = flag('place-calls');
if (val('tier', '')) process.env.REGRESSION_TIER = val('tier'); // e.g. --tier lite: publish versions on that pricing tier
if (val('voice', '')) process.env.REGRESSION_VOICE = val('voice'); // e.g. --voice custom:en-us-warm-f
if (val('llm', '')) process.env.REGRESSION_LLM = val('llm'); // e.g. --llm gemini-3.1-flash-lite: publish versions with that language model
if (val('routing', '')) {
  // e.g. --routing expert_backup: publish versions with the paid Expert backup extra (needs --tier lite or standard; the API refuses it otherwise)
  if (val('routing') !== 'expert_backup') { console.error(`Unknown --routing "${val('routing')}". Valid: expert_backup`); process.exit(1); }
  if (!['lite', 'standard'].includes(val('tier', ''))) { console.error('--routing expert_backup needs --tier lite or --tier standard (Pro has the strongest model already).'); process.exit(1); }
  process.env.REGRESSION_ROUTING = val('routing');
}
const maxCalls = Number(val('max-calls', 8));
const wanted = val('scenario', '') ? val('scenario').split(',').map((s) => s.trim()).filter(Boolean) : [];

const env = loadEnv();
requireEnv(env, ['REGRESSION_NUMBER', 'CALL_LOOP_POC_BASE_URL', 'CALL_LOOP_POC_TEST_CALL_SECRET', 'NEXTAUTH_SECRET', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
const scenarios = pick(wanted);
const skipped = scenarios.filter((s) => s.skip);
for (const s of skipped) console.log(`  skipped ${s.id}: ${s.skip}`);
scenarios.splice(0, scenarios.length, ...scenarios.filter((s) => !s.skip));
const spend = checkSpend({ wanted: scenarios.length, maxCalls });

console.log(`Scenarios (${scenarios.length}): ${scenarios.map((s) => s.id).join(', ')}`);
console.log(`Calls used so far: ${callsUsed()} of ${TOTAL_CALL_CAP}. ${spend.ok ? `Estimated cost of this run: about $${spend.estimateUsd}.` : `REFUSED: ${spend.reason}`}`);
if (!place) { console.log('\nDry run only (add --place-calls to dial). Nothing was published, routed or called.'); process.exit(spend.ok ? 0 : 1); }
if (!spend.ok) process.exit(1);

const d = db(env);
const api = await apiClient(env);
const fx = await ensureFixtures(env, d, api);
const results = [];
mkdirSync(resolve(process.cwd(), 'out/regression'), { recursive: true });

for (const sc of scenarios) {
  const t0 = Date.now();
  let res;
  // One automatic retry when the failure looks like infrastructure (engine release changed during the run, or the call was cut off with no
  // transcript), never for a plain assertion failure. The retry is one more real call and is refused past the lifetime cap.
  for (let attempt = 1; ; attempt++) {
  const releaseBefore = engineRelease();
  let since = new Date().toISOString();
  let retryable = null;
  res = { id: sc.id, title: sc.title, status: 'error', failures: [], knownIssue: sc.knownIssue || null };
  try {
    // `prepare` may publish helper versions (a transfer target, another agent) and return the version under test.
    const receiver = sc.needsReceiver ? makeReceiver(env, newRunId()) : null;
    const ctx = { env, d, api, fx, receiver, publish: (opts) => publishVersion(api, fx, sc, opts), route: (numberId, versionId, direction) => routeNumber(api, numberId, versionId, direction) };
    const prepared = sc.prepare ? await sc.prepare(ctx) : null;
    const versionId = await publishVersion(api, fx, sc, prepared ? { version: prepared } : {});
    since = new Date(Date.now() - 5000).toISOString();
    let sid, logs = null, log;
    if (sc.outbound) {
      // Outbound: this tenant's number calls the scripted receiver number, answering as its OUTBOUND version.
      const target = fx.extra.REGRESSION_NUMBER_C?.number;
      if (!target) throw new Error('REGRESSION_NUMBER_C is not set in .env');
      await receiver.setMode(sc.outbound.mode);
      await routeNumber(api, fx.numberId, versionId, 'outbound');
      sid = await placeOutboundCall(env, { from: fx.number, to: target });
      recordCall();
      await waitForCallEnd(env, sid);
      logs = await fetchTenantLogsSince(d, fx.tenantId, since, { excludeSid: null });
      // An outbound call is logged with the tenant's own number in to_number, so pick it by direction.
      log = logs.find((l) => l.direction === 'outbound') || null;
    } else {
      await routeNumber(api, fx.numberId, versionId);
      sid = await placeShopperCall(env, { number: fx.number, persona: sc.persona, language: sc.shopperLanguage, speakFirst: sc.speakFirst });
      recordCall();
      await waitForCallEnd(env, sid);
      logs = sc.needsAllLogs ? await fetchTenantLogsSince(d, fx.tenantId, since, { excludeSid: sid }) : null;
      // For a multi-call scenario the main log is the first one that reached the number under test.
      log = sc.needsAllLogs ? logs.find((l) => l.to_number === fx.number) || logs[0] : await fetchTenantCallLog(d, fx.tenantId, since, { excludeSid: sid });
    }
    if (!log) { const dg = await diagnoseMissingLog(d, fx.tenantId, since); res.failures = [dg.message]; retryable = dg.retryable; }
    else {
      const events = receiver ? await receiver.events() : null;
      res.failures = sc.assert(log, { logs, ctx, events });
      if (events) res.receiverEvents = events.map((e) => ({ kind: e.kind, method: e.method, query: e.query, body: String(e.body).slice(0, 300), authorization: e.headers?.authorization ? '(present)' : null }));
      res.durationSeconds = log.duration_seconds;
      res.transcript = lines(log).slice(0, 40);
      if (logs) res.otherCalls = logs.filter((l) => l.id !== log.id).map((l) => ({ to: l.to_number, direction: l.direction, durationSeconds: l.duration_seconds, transcript: lines(l).slice(0, 12) }));
    }
    res.status = res.failures.length === 0 ? 'pass' : 'fail';
  } catch (e) {
    res.failures = [e instanceof Error ? e.message : String(e)];
  }
  const releaseAfter = engineRelease();
  const releaseChanged = !!(releaseBefore && releaseAfter && releaseBefore !== releaseAfter);
  if (releaseChanged) res.releaseChanged = `${releaseBefore} -> ${releaseAfter}`;
  if (res.status !== 'pass' && (releaseChanged || retryable) && attempt === 1 && callsUsed() + 1 <= TOTAL_CALL_CAP) {
    console.log(`  retrying ${sc.id} once: ${releaseChanged ? `engine release changed during the run (${res.releaseChanged})` : res.failures[0]}`);
    continue;
  }
  if (res.status !== 'pass' && releaseChanged) res.failures.push(`inconclusive: engine release changed during the run (${res.releaseChanged})`);
  break;
  }
  res.seconds = Math.round((Date.now() - t0) / 1000);
  if (sc.needsReceiver && res.receiverEvents !== undefined) { /* events already captured above */ }
  const label = res.status === 'pass' ? (sc.knownIssue ? 'FIXED (was a known issue)' : 'pass') : (sc.knownIssue ? 'still failing (known)' : res.status.toUpperCase());
  console.log(`  ${label.padEnd(26)} ${sc.id}  (${res.seconds}s)${res.failures.length ? `\n      ${res.failures.join('\n      ')}` : ''}`);
  results.push(res);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(resolve(process.cwd(), `out/regression/${stamp}.json`), JSON.stringify({ ranAt: stamp, results }, null, 2));
const bad = results.filter((r) => r.status !== 'pass' && !r.knownIssue);
console.log(`\n${results.filter((r) => r.status === 'pass').length}/${results.length} passed; ${bad.length} unexpected failure(s). Details: out/regression/${stamp}.json`);
process.exit(bad.length ? 1 : 0);
