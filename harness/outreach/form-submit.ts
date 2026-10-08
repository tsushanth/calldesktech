import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { chromium, type Browser } from 'playwright';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveProduct, leadsTable, suppressionsTable, scopeToProduct } from '@/lib/outreach/products';
import {
  CircuitBreaker,
  capBlock,
  domainOfEmail,
  isNonUsCaLead,
  emptyLedger,
  nextDelayMs,
  preflightNeedsManual,
  planFields,
  qualityGate,
  recordInLedger,
  resolveDailyCap,
  resolveHourlyCap,
  resolveReplyToEmail,
  skipReason,
  type DayLedger,
  type FormAttempt,
  type FormOutreachStatus,
} from '@/lib/outreach/formSubmit';
import { CHROMIUM_UA, submitOnPage } from '@/lib/outreach/formSubmitBrowser';
import { logWorkerAttempt, workerLogRow } from '@/lib/outreach/formWorkerLog';
import type { ContactForm } from '@/lib/outreach/discovery/contactPages';

// Submits contact forms a HUMAN queued from the admin queue ("Submit for me"),
// one at a time, in a real Chromium. Run by launchd like run.ts.
//
//   *** It only ever picks up leads whose formOutreach.status is 'queued'. ***
//
// Nothing here discovers, drafts, or decides who to contact: a person read the
// drafted message and clicked the button. Guard rails, all enforced in code:
//   STOP file            -> run nothing (touch ~/.calldesk-forms/STOP)
//   daily cap            -> OUTREACH_FORM_SUBMIT_MAX_PER_DAY (default 15, hard max 50)
//   hourly cap           -> 5, so a run cannot burst the day's budget
//   per-domain cap       -> 1 submission per domain per day
//   one per lead ever    -> a 'submitted' lead is never eligible again
//   suppression/replied  -> suppressed domains, replied leads and region_blocked leads are skipped
//   pacing               -> random 20-40 s between submissions
//   circuit breaker      -> 5 consecutive failed/unconfirmed attempts stops the run
//   captcha              -> ANY bot challenge is an immediate needs_manual; never solved or bypassed
//   evidence only        -> 'submitted' requires proof of receipt, otherwise needs_manual 'unconfirmed'
//
// The browser is a stock headless Chromium with a normal Chromium UA. No stealth
// plugins, no evasion, no proxies: we are not hiding that this is a program, we
// are filling a public contact form with a real message and a real reply address.

const product = resolveProduct(process.env.PRODUCT);
const BASE = join(homedir(), '.calldesk-forms');
const STOP = join(BASE, 'STOP');
const LEDGER = join(BASE, 'ledger.json');
const RUNS = join(BASE, 'runs.jsonl');
const BREAKER = join(BASE, 'circuit-breaker.txt');
const DEADLINE_MS = 25 * 60_000;

// For forms that cap the message length (the full draft plus opt-out is about 850 characters). Complete on its own, opt-out included.
const SHORT_BODY = "Calldesk (calldesk.tech): AI phone agents from 2 cents a minute, voice included. Our voices cut a typical call's cost roughly 45% vs ElevenLabs Flash/Turbo, at list prices. Speech API from $0.004 per 1,000 chars. Open to partnering? Reply STOP to opt out.";

interface LeadRow {
  id: string;
  company_name: string;
  domain: string | null;
  score: number | null;
  product: string | null;
  contact_source_url: string | null;
  location: string | null;
  source_key: string | null;
  region_blocked: boolean | null;
  replied_at: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signals: any;
}

function readLedger(): DayLedger {
  try {
    const parsed = JSON.parse(readFileSync(LEDGER, 'utf8')) as DayLedger;
    if (parsed && typeof parsed.date === 'string') return parsed;
  } catch {
    // no ledger yet
  }
  return emptyLedger();
}

function writeLedger(ledger: DayLedger): void {
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function suppressedDomains(db: any): Promise<Set<string>> {
  const out = new Set<string>();
  const { data } = await db.from(suppressionsTable(product)).select('email');
  for (const row of (data ?? []) as { email: string }[]) {
    const d = domainOfEmail(String(row.email).toLowerCase());
    if (d) out.add(d);
  }
  return out;
}

/** Writes the new status and appends the attempt to formOutreach. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persist(db: any, lead: LeadRow, status: FormOutreachStatus, extra: Record<string, unknown>, attempt?: FormAttempt, pageUsed?: string) {
  const fo = lead.signals.formOutreach;
  const attempts = [...(fo.attempts ?? []), ...(attempt ? [attempt] : [])];
  const now = new Date().toISOString();
  const next = {
    ...fo,
    status,
    attempts,
    reason: undefined,
    error: undefined,
    ...extra,
    ...(status === 'submitted' ? { submittedAt: now } : {}),
  };
  const { error } = await db
    .from(leadsTable(product))
    .update({ signals: { ...lead.signals, formOutreach: next }, updated_at: now })
    .eq('id', lead.id);
  if (error) log(`could not persist ${lead.company_name}: ${error.message}`);
  // The Worker tab's record of what the worker did (best effort).
  if (attempt && !error) await logWorkerAttempt(db, workerLogRow(lead, attempt, { pageUrl: pageUsed }));
}

async function main(): Promise<number> {
  mkdirSync(BASE, { recursive: true });
  const startedAt = Date.now();
  const dryRun = process.env.DRY_RUN === '1';

  if (existsSync(STOP)) {
    log('STOP file present, not running');
    return 0;
  }

  const replyTo = resolveReplyToEmail(process.env);
  if (!replyTo) {
    console.error('OUTREACH_REPLYTO_EMAIL (or OUTREACH_FROM_EMAIL) must be set: the form needs a real reply address');
    return 2;
  }

  const cap = resolveDailyCap(process.env.OUTREACH_FORM_SUBMIT_MAX_PER_DAY);
  const hourCap = resolveHourlyCap(process.env.OUTREACH_FORM_SUBMIT_MAX_PER_HOUR);
  const delayMin = Number(process.env.OUTREACH_FORM_SUBMIT_DELAY_MIN_MS) || undefined;
  const delayMax = Number(process.env.OUTREACH_FORM_SUBMIT_DELAY_MAX_MS) || undefined;
  const breakerLimit = Number(process.env.OUTREACH_FORM_SUBMIT_BREAKER) || undefined;
  const phone = (process.env.OUTREACH_FORM_PHONE || '').trim() || undefined;
  const env = process.env;
  const address = env.OUTREACH_FORM_ADDR_LINE1 && env.OUTREACH_FORM_ADDR_CITY && env.OUTREACH_FORM_ADDR_STATE && env.OUTREACH_FORM_ADDR_ZIP
    ? { line1: env.OUTREACH_FORM_ADDR_LINE1.trim(), line2: env.OUTREACH_FORM_ADDR_LINE2?.trim() || undefined, city: env.OUTREACH_FORM_ADDR_CITY.trim(), state: env.OUTREACH_FORM_ADDR_STATE.trim(), zip: env.OUTREACH_FORM_ADDR_ZIP.trim(), country: env.OUTREACH_FORM_ADDR_COUNTRY?.trim() || undefined }
    : undefined;
  if (cap === 0) {
    log('daily cap is 0, nothing to do');
    return 0;
  }

  const db = getSupabaseAdmin();
  const suppressed = await suppressedDomains(db);

  // Default: only 'queued' (a human clicked "Submit for me"). With OUTREACH_FORM_AUTOSUBMIT=1 (the owner's
  // explicit choice, set on the machine that runs this worker) 'ready' leads are also processed, highest
  // score first, under the same quality gate, caps and circuit breaker; ready leads the gate rejected
  // carry a skipReason and are not re-tried.
  const auto = process.env.OUTREACH_FORM_AUTOSUBMIT === '1';
  // OUTREACH_FORM_SCOPE: 'reseller' = the plain 'calldesk' product (agencies and platforms; includes leads whose form was entered by hand and has no
  // stored fields, the worker reads the live page), 'verticals' = 'calldesk:<vertical>' leads, unset = every product, form_only leads only (the old rule).
  const scope = (process.env.OUTREACH_FORM_SCOPE || '').trim().toLowerCase();
  let q = db.from(leadsTable(product)).select('id, company_name, domain, score, product, location, source_key, contact_source_url, region_blocked, replied_at, signals')
    .in('signals->formOutreach->>status', auto ? ['queued', 'ready'] : ['queued']);
  if (scope === 'reseller') q = q.eq('product', 'calldesk');
  else if (scope === 'verticals') q = q.like('product', 'calldesk:%').eq('contact_status', 'form_only');
  else if (scope === 'all') q = q.or('contact_status.eq.form_only,product.eq.calldesk');
  else q = q.eq('contact_status', 'form_only');
  if (auto) q = q.is('signals->formOutreach->>skipReason', null);
  // The vertical products ('calldesk:homecare', ...) share the plain product's tables, so for those scopes the product filter above is the only one.
  const scoped = scope === 'verticals' || scope === 'all' ? q : scopeToProduct(q, product);
  const { data } = await scoped.order('score', { ascending: false }).limit(100);
  const leads = (data ?? []) as LeadRow[];
  log(`${leads.length} ${auto ? 'queued/ready (AUTO mode)' : 'queued'} form lead(s); cap ${cap}/day`);

  let ledger = readLedger();
  const breaker = new CircuitBreaker(breakerLimit);
  const summary = { queued: leads.length, submitted: 0, needsManual: 0, failed: 0, skipped: 0, capped: 0 };

  let browser: Browser | null = null;
  try {
    for (const lead of leads) {
      if (existsSync(STOP)) { log('STOP file appeared, winding down'); break; }
      if (Date.now() - startedAt > DEADLINE_MS) { log('deadline reached, winding down'); break; }
      if (breaker.tripped) {
        const reason = `circuit breaker: ${breaker.reason}`;
        log(`${reason}; stopping the run`);
        writeFileSync(BREAKER, `${new Date().toISOString()} ${reason}\n`);
        break;
      }

      const fo = lead.signals?.formOutreach;
      const cf = lead.signals?.contactForm as ContactForm | undefined;
      const eligibility = {
        status: fo?.status as FormOutreachStatus,
        domain: lead.domain,
        regionBlocked: lead.region_blocked,
        repliedAt: lead.replied_at,
        hasContactForm: Boolean(cf),
        staticCaptcha: cf?.captcha,
        embedded: cf?.method === 'embedded',
      };

      const skip = skipReason(eligibility, suppressed, { auto });
      if (skip) {
        log(`skip ${lead.company_name}: ${skip}`);
        summary.skipped++;
        continue;
      }

      // Vertical leads are for US and Canadian businesses (current policy); older leads from other countries are left alone for a human.
      if (lead.product?.startsWith('calldesk:') && process.env.ALLOW_INTL_FORMS !== '1' && isNonUsCaLead({ domain: lead.domain, location: lead.location, sourceKey: lead.source_key })) {
        const why = 'outside the US and Canada (current outreach policy)';
        log(`skip ${lead.company_name}: ${why}`);
        summary.skipped++;
        if (!dryRun && fo?.status === 'ready' && fo.skipReason !== why) await persist(db, lead, 'ready', { skipReason: why });
        continue;
      }

      const blocked = capBlock(ledger, lead.domain, cap, new Date(), hourCap);
      if (blocked) {
        log(`skip ${lead.company_name}: ${blocked}`);
        summary.capped++;
        // Daily/hourly caps apply to the whole run; a per-domain block does not.
        if (blocked.includes('cap of')) break;
        continue;
      }

      // A captcha or third-party embed we already know about: no browser needed.
      const pre = preflightNeedsManual(eligibility);
      if (pre) {
        log(`${lead.company_name}: needs manual (${pre})`);
        summary.needsManual++;
        if (!dryRun) {
          await persist(db, lead, 'needs_manual', { reason: pre }, { at: new Date().toISOString(), outcome: 'needs_manual', reason: pre });
        }
        continue;
      }

      const pageUrl = cf!.pageUrl || lead.contact_source_url;
      if (!pageUrl) {
        log(`${lead.company_name}: needs manual (no form page address)`);
        summary.needsManual++;
        if (!dryRun) await persist(db, lead, 'needs_manual', { reason: 'no form page address' }, { at: new Date().toISOString(), outcome: 'needs_manual', reason: 'no form page address' });
        continue;
      }

      // Belt and braces: the quality gate re-checks the draft and the form's
      // static field list before a real message goes to a real business.
      // Measured on the DRAFT body: the opt-out and signature lines we append are
      // fixed boilerplate and would skew the 40-160 word band.
      const gate = qualityGate({
        score: lead.score,
        body: fo.body,
        // A form with no stored fields (entered by hand) is judged on the live page instead.
        mappingNeedsManual: cf!.fields.length ? planFields(cf!.fields, [], { email: replyTo, subject: fo.subject, message: fo.body, phone, address }).needsManual : null,
      });
      if (gate) {
        log(`skip ${lead.company_name}: ${gate}`);
        summary.skipped++;
        if (!dryRun) {
          if (fo.status === 'ready') await persist(db, lead, 'ready', { skipReason: gate }); // auto mode: leave for the human, do not retry
          else await persist(db, lead, 'needs_manual', { reason: gate }, { at: new Date().toISOString(), outcome: 'needs_manual', reason: gate });
        }
        continue;
      }

      if (dryRun) {
        log(`DRY_RUN: would submit ${pageUrl} for ${lead.company_name}`);
        summary.skipped++;
        continue;
      }

      const shotDir = join(BASE, lead.id);
      mkdirSync(shotDir, { recursive: true });
      // 'submitting' is the in-flight lock: the UI shows it, and a crashed run
      // leaves it visible rather than silently retrying.
      await persist(db, lead, 'submitting', {});

      browser ??= await chromium.launch();
      const context = await browser.newContext({ userAgent: CHROMIUM_UA, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const at = new Date().toISOString();
      try {
        await page.goto(pageUrl, { waitUntil: 'load', timeout: 45_000 });
        const result = await submitOnPage(page, {
          body: fo.body,
          subject: fo.subject,
          email: replyTo,
          expectedFieldNames: cf!.fields.map((f) => f.name),
          phone,
          address,
          fallbackPaths: ['/contact', '/contact-us', '/get-in-touch'],
          shortBody: SHORT_BODY,
          screenshotDir: shotDir,
        });
        const shot = result.screenshots[result.screenshots.length - 1];
        if (result.outcome.status === 'submitted') {
          log(`submitted ${lead.company_name}`);
          summary.submitted++;
          breaker.record('submitted');
          await persist(db, lead, 'submitted', {}, { at, outcome: 'submitted', screenshot: shot }, result.pageUrl);
        } else {
          log(`needs manual ${lead.company_name}: ${result.outcome.reason}`);
          summary.needsManual++;
          breaker.record('needs_manual', result.outcome.reason);
          await persist(db, lead, 'needs_manual', { reason: result.outcome.reason }, { at, outcome: 'needs_manual', reason: result.outcome.reason, screenshot: shot }, result.pageUrl);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`failed ${lead.company_name}: ${message}`);
        summary.failed++;
        breaker.record('failed');
        await persist(db, lead, 'failed', { error: message }, { at, outcome: 'failed', reason: message });
      } finally {
        await context.close().catch(() => undefined);
      }

      // Counted whether or not it confirmed: we touched the site either way.
      ledger = recordInLedger(ledger, lead.domain);
      writeLedger(ledger);

      const delay = nextDelayMs(Math.random, delayMin, delayMax);
      log(`waiting ${Math.round(delay / 1000)}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const line = { at: new Date().toISOString(), seconds: Math.round((Date.now() - startedAt) / 1000), product: product.id, ...summary };
  appendFileSync(RUNS, JSON.stringify(line) + '\n');
  console.log(JSON.stringify(summary, null, 1));
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error('form-submit crashed:', error);
  process.exit(1);
});
