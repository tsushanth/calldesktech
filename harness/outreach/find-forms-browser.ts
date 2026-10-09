#!/usr/bin/env -S node --import tsx
// Finds contact forms the static-HTML contact finder cannot see (forms a script builds after the page loads: Wix, Squarespace, page builders).
// Takes leads whose contact check found NOTHING (contact_status 'none'), opens /contact, /contact-us and / in a real browser, and when a page shows
// a form with a message box and no email is listed on it, marks the lead 'form_only' with signals.contactForm. The daily pipeline then drafts the message
// and the form worker (form-submit.ts) sends it. Never submits anything. Robots.txt respected. Every lead checked gets signals.browserFormCheck so it is not re-opened.
//
//   FORM_FINDER_APPLY=1   write results (default: dry run, prints only)
//   FORM_FINDER_LIMIT=150 leads per run
//   FORM_FINDER_CONCURRENCY=4
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { getSupabaseAdmin } from '@/lib/supabase';
import { politeFetchText } from '@/lib/outreach/discovery/http';
import type { ContactForm } from '@/lib/outreach/discovery/contactPages';
import { isPlatformDomain } from '@/lib/outreach/platformBlocklist';
import { isNonUsCaLead } from '@/lib/outreach/formSubmit';

const APPLY = process.env.FORM_FINDER_APPLY === '1';
const LIMIT = Number(process.env.FORM_FINDER_LIMIT || 150);
const CONCURRENCY = Number(process.env.FORM_FINDER_CONCURRENCY || 4);
const PATHS = ['/contact', '/contact-us', '/'];
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

type Lead = { id: string; company_name: string; domain: string; location: string | null; source_key: string | null; signals: Record<string, unknown> | null };
type Found = { form: ContactForm; hasEmail: boolean };

async function disallowed(domain: string): Promise<string[]> {
  const r = await politeFetchText(`https://${domain}/robots.txt`, 6000);
  return r.ok ? [...r.text.matchAll(/^\s*disallow:\s*(\S+)/gim)].map((m) => m[1]) : [];
}

// Runs in the page: the first real contact form (has a message box, is not search/login), its fields, whether a captcha is loaded, and whether an email is shown.
function inspectPage() {
  const html = document.documentElement.innerHTML;
  for (const f of Array.from(document.querySelectorAll('form'))) {
    if (!f.querySelector('textarea') || /search|login|password|signin/i.test(f.outerHTML.slice(0, 400))) continue;
    const fields = Array.from(f.querySelectorAll('input,textarea,select'))
      .filter((i) => !['hidden', 'submit', 'button', 'image', 'checkbox', 'radio'].includes((i as HTMLInputElement).type))
      .map((i) => ({ name: (i as HTMLInputElement).name || i.id || (i.getAttribute('aria-label') ?? ''), type: i.tagName === 'INPUT' ? (i as HTMLInputElement).type : i.tagName.toLowerCase(), required: (i as HTMLInputElement).required }))
      .filter((x) => x.name);
    return {
      fields,
      action: f.getAttribute('action'),
      method: (f.getAttribute('method') || 'post').toLowerCase(),
      captcha: /g-recaptcha|hcaptcha|cf-turnstile|captcha/i.test(html),
      hasEmail: !!document.querySelector('a[href^="mailto:"]') || /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(document.body.innerText),
    };
  }
  return null;
}

async function findForm(ctx: import('playwright').BrowserContext, domain: string): Promise<Found | null> {
  const blocked = await disallowed(domain);
  for (const p of PATHS) {
    if (blocked.some((b) => b === '/' || (b !== '' && p.startsWith(b)))) continue;
    const page = await ctx.newPage();
    try {
      await page.goto(`https://${domain}${p}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForSelector('form textarea', { timeout: 5_000 }).catch(() => null);
      const info = await page.evaluate(inspectPage);
      if (info) {
        const pageUrl = page.url();
        return { hasEmail: info.hasEmail, form: { pageUrl, action: info.action, method: info.method, fields: info.fields, captcha: info.captcha } };
      }
    } catch { /* unreachable or slow: try the next path */ } finally { await page.close(); }
  }
  return null;
}

type Db = ReturnType<typeof getSupabaseAdmin>;
async function draftResellerForms(db: Db) {
  const { data: ref } = await db.from('calldesk_outreach_leads').select('signals').eq('product', 'calldesk')
    .eq('signals->formOutreach->>status', 'submitted').limit(1).maybeSingle();
  const base = (ref?.signals as { formOutreach?: { subject?: string; body?: string } } | null)?.formOutreach;
  if (!base?.subject || !base?.body) { log('no reference reseller message found; reseller form leads not drafted'); return; }
  const { data } = await db.from('calldesk_outreach_leads').select('id, signals, replied_at')
    .eq('product', 'calldesk').eq('contact_status', 'form_only').eq('status', 'new').limit(500);
  let n = 0;
  for (const l of (data ?? []) as { id: string; signals: Record<string, unknown> | null; replied_at: string | null }[]) {
    if (l.replied_at || l.signals?.formOutreach || !(l.signals?.contactForm as { pageUrl?: string } | undefined)?.pageUrl) continue;
    const now = new Date().toISOString();
    const { error } = await db.from('calldesk_outreach_leads')
      .update({ signals: { ...l.signals, formOutreach: { subject: base.subject, body: base.body, status: 'ready', draftedAt: now } }, updated_at: now }).eq('id', l.id);
    if (!error) n++;
  }
  log(`drafted ${n} reseller form lead(s) with the reseller message`);
}

(async () => {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('calldesk_outreach_leads')
    .select('id, company_name, domain, location, source_key, product, score, signals')
    .eq('contact_status', 'none').eq('status', 'new').eq('region_blocked', false)
    .not('domain', 'is', null)
    .limit(2000);
  log(`${data?.length ?? 0} candidate row(s) before filters${error ? `, query error: ${error.message}` : ''}`);
  // The JSON-path filter for already-checked leads is done here: in SQL it times out on this table.
  const leads = ((data ?? []) as (Lead & { product: string; score: number | null })[])
    .filter((l) => l.product.startsWith('calldesk'))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .filter((l) => !(l.signals as { browserFormCheck?: unknown } | null)?.browserFormCheck)
    .filter((l) => !isPlatformDomain(l.domain) && !isNonUsCaLead({ domain: l.domain, location: l.location, source_key: l.source_key } as never))
    .slice(0, LIMIT);
  // Second pool: leads that were never contact-checked but have a website. Walked in id order with a cursor file, because checked leads that show
  // no form stay 'unknown' and would otherwise be fetched again and again.
  const cursorFile = process.env.FORM_FINDER_CURSOR || path.join(os.homedir(), '.calldesk-forms', 'find-cursor');
  const START = '00000000-0000-0000-0000-000000000000';
  let cursor = START;
  try { cursor = fs.readFileSync(cursorFile, 'utf8').trim() || START; } catch { /* first run */ }
  if (leads.length < LIMIT) {
    const { data: more, error: moreError } = await db.from('calldesk_outreach_leads')
      .select('id, company_name, domain, location, source_key, product, score, signals')
      .eq('contact_status', 'unknown').eq('status', 'new').eq('region_blocked', false).not('domain', 'is', null)
      .gt('id', cursor).order('id', { ascending: true }).limit(LIMIT * 3);
    if (moreError) log(`unknown-pool query error: ${moreError.message}`);
    const rowsMore = (more ?? []) as (Lead & { product: string })[];
    log(`${rowsMore.length} never-checked lead(s) with a website after cursor ${cursor}`);
    if (APPLY) { try { fs.writeFileSync(cursorFile, rowsMore.length ? rowsMore[rowsMore.length - 1].id : START); } catch { /* retry next run */ } }
    leads.push(...rowsMore
      .filter((l) => l.product.startsWith('calldesk'))
      .filter((l) => !(l.signals as { browserFormCheck?: unknown } | null)?.browserFormCheck)
      .filter((l) => !isPlatformDomain(l.domain) && !isNonUsCaLead({ domain: l.domain, location: l.location, source_key: l.source_key } as never))
      .slice(0, LIMIT - leads.length));
  }
  log(`${leads.length} lead(s) to check (${APPLY ? 'APPLY' : 'dry run'})`);

  // Reseller leads are not drafted by the daily vertical pipeline, so give every reseller form lead (new finds and any earlier ones without a draft)
  // the message already used for the reseller form submissions, so the form worker can send it. Vertical leads are drafted by that pipeline.
  if (APPLY) await draftResellerForms(db);

  const browser = await chromium.launch();
  const tally = { checked: 0, form: 0, formWithEmail: 0, none: 0, errors: 0 };
  let next = 0;
  async function worker() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (;;) {
      const lead = leads[next++];
      if (!lead) break;
      try {
        const found = await findForm(ctx, lead.domain);
        tally.checked++;
        const now = new Date().toISOString();
        // A page that also lists an email is left for the email pipeline; only the check is recorded.
        const useForm = found && !found.hasEmail;
        if (found) { tally.form++; if (found.hasEmail) tally.formWithEmail++; } else tally.none++;
        log(`${lead.domain}: ${useForm ? `FORM ${found.form.pageUrl}` : found ? 'form but an email is listed (left alone)' : 'nothing'}`);
        if (!APPLY) continue;
        const signals = { ...(lead.signals ?? {}), browserFormCheck: { at: now, found: !!found, email: found?.hasEmail ?? false }, ...(useForm ? { contactForm: found.form } : {}) };
        const patch = useForm ? { contact_status: 'form_only', contact_source_url: found.form.pageUrl, signals, updated_at: now } : { signals, updated_at: now };
        const { error } = await db.from('calldesk_outreach_leads').update(patch).eq('id', lead.id);
        if (error) { tally.errors++; log(`update failed for ${lead.domain}: ${error.message}`); }
      } catch (error) { tally.errors++; log(`error ${lead.domain}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();
  log(`done ${JSON.stringify(tally)}`);
})();
