// The browser half of contact-form submission: read the rendered form, apply the
// plan from formSubmit.ts, submit, and report evidence. All judgment lives in
// formSubmit.ts; this file only observes and acts.
//
// Deliberately NOT here: any attempt to solve, bypass, or work around a captcha
// or bot challenge. detectChallenge() runs before anything is typed and the run
// stops on the first sign of one. No stealth plugins, no UA spoofing beyond
// Chromium's own default, no proxy rotation. The page is opened the way a person
// opens it, and the form is the site's own public contact form.

import type { Frame, Page } from 'playwright';
import {
  composeMessage,
  decideOutcome,
  detectChallenge,
  lengthLimitRefusal,
  planFields,
  type CheckboxDescriptor,
  type FieldDescriptor,
  type MappingContext,
  type Outcome,
  type SubmitEvidence,
} from './formSubmit';

export interface ReadForm {
  /** Marker attribute value identifying this form in the DOM. */
  marker: string;
  fields: FieldDescriptor[];
  checkboxes: CheckboxDescriptor[];
  hasTextarea: boolean;
  hasSubmit: boolean;
}

export interface FrameForms {
  frame: Frame;
  forms: ReadForm[];
  html: string;
  text: string;
}

export const CHROMIUM_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Runs inside the page. Tags every candidate form and field with a marker
// attribute so we can address them later, and reports what it found.
/* c8 ignore start -- executed in the browser, covered by the integration test */
// Passed to frame.evaluate() as an EXPRESSION string (an IIFE), not a function:
// Playwright evaluates a string argument as an expression, and a serialized
// arrow function would come back as an opaque object instead of running.
const READ_FORMS_SRC = `(() => {
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (el.type === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return el.offsetParent !== null || style.position === 'fixed';
  };
  const labelFor = (el) => {
    const id = el.getAttribute('id');
    if (id) {
      const l = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (l && l.textContent) return l.textContent.trim().slice(0, 160);
    }
    const wrap = el.closest('label');
    if (wrap && wrap.textContent) return wrap.textContent.trim().slice(0, 160);
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, 160);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = document.getElementById(labelledBy);
      if (t && t.textContent) return t.textContent.trim().slice(0, 160);
    }
    return undefined;
  };
  const out = [];
  let n = 0;
  for (const form of Array.from(document.querySelectorAll('form'))) {
    const marker = 'cdf' + (n++);
    form.setAttribute('data-cd-form', marker);
    const fields = [];
    const checkboxes = [];
    let hasTextarea = false;
    for (const el of Array.from(form.querySelectorAll('input, textarea, select'))) {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
      const name = el.getAttribute('name') || el.getAttribute('id');
      if (!name) continue;
      if (['submit', 'button', 'image', 'reset', 'file', 'radio'].includes(type)) continue;
      const desc = {
        name: name,
        type: type,
        required: el.required === true || el.getAttribute('aria-required') === 'true',
        label: labelFor(el),
        placeholder: el.getAttribute('placeholder') || undefined,
        id: el.getAttribute('id') || undefined,
        hidden: !visible(el),
        maxLength: el.maxLength > 0 ? el.maxLength : undefined,
      };
      const fieldMarker = marker + '_' + fields.length + '_' + checkboxes.length;
      el.setAttribute('data-cd-field', fieldMarker);
      if (type === 'checkbox') {
        checkboxes.push(Object.assign({}, desc, { checked: el.checked === true, marker: fieldMarker }));
      } else {
        if (type === 'textarea') hasTextarea = true;
        fields.push(Object.assign({}, desc, { marker: fieldMarker }));
      }
    }
    const submit = form.querySelector('input[type=submit], button[type=submit], button:not([type])');
    if (submit) submit.setAttribute('data-cd-submit', marker);
    out.push({ marker: marker, fields: fields, checkboxes: checkboxes, hasTextarea: hasTextarea, hasSubmit: !!submit });
  }
  return out;
})()`;
/* c8 ignore stop */

type MarkedField = FieldDescriptor & { marker: string };
type MarkedCheckbox = CheckboxDescriptor & { marker: string };

/** Same-origin frames only: a cross-origin embed is a third-party form we refuse to touch. */
export function sameOriginFrames(page: Page): Frame[] {
  const origin = (u: string) => {
    try { return new URL(u).origin; } catch { return null; }
  };
  const pageOrigin = origin(page.url());
  return page.frames().filter((f) => {
    if (f === page.mainFrame()) return true;
    const o = origin(f.url());
    return o !== null && o === pageOrigin;
  });
}

export async function readFrames(page: Page): Promise<FrameForms[]> {
  const out: FrameForms[] = [];
  for (const frame of sameOriginFrames(page)) {
    try {
      const forms = (await frame.evaluate(READ_FORMS_SRC)) as ReadForm[];
      const html = await frame.content();
      const text = await frame.evaluate('document.body ? document.body.innerText : ""') as string;
      out.push({ frame, forms, html, text });
    } catch {
      // A frame that navigated away mid-read is simply skipped.
    }
  }
  return out;
}

/**
 * Picks the form that matches the statically detected one, by field-name overlap.
 * Requires a free-text message field: a newsletter box is not a contact form.
 */
export function pickForm(frames: FrameForms[], expectedFieldNames: string[]): { frame: Frame; form: ReadForm } | null {
  const expected = new Set(expectedFieldNames.map((n) => n.toLowerCase()));
  let best: { frame: Frame; form: ReadForm; score: number } | null = null;
  for (const ff of frames) {
    for (const form of ff.forms) {
      if (!form.hasTextarea) continue;
      const overlap = form.fields.filter((f) => expected.has(f.name.toLowerCase())).length;
      // Tie-break on field count so the richest matching form wins.
      const score = overlap * 100 + form.fields.length;
      if (!best || score > best.score) best = { frame: ff.frame, form, score };
    }
  }
  return best ? { frame: best.frame, form: best.form } : null;
}

export interface SubmitContext extends Omit<MappingContext, 'message'> {
  /** The draft body; the opt-out and signature lines are appended here. */
  body: string;
  /** Field names from signals.contactForm, used to find the same form again. */
  expectedFieldNames: string[];
  brandName?: string;
  brandSite?: string;
  /** Where the before/after screenshots go. */
  screenshotDir: string;
  /** Injected so tests can avoid the filesystem. */
  screenshot?: (page: Page, path: string) => Promise<void>;
}

export interface SubmitResult {
  outcome: Outcome;
  screenshots: string[];
  /** For the log/attempt record. */
  detail?: string;
}

const defaultScreenshot = async (page: Page, path: string) => {
  await page.screenshot({ path, fullPage: true });
};

/**
 * One attempt against one already-open page. Never throws for an expected
 * refusal -- it returns a needs_manual outcome instead.
 */
export async function submitOnPage(page: Page, ctx: SubmitContext): Promise<SubmitResult> {
  const shoot = ctx.screenshot ?? defaultScreenshot;
  const screenshots: string[] = [];
  const shot = async (label: string) => {
    const path = `${ctx.screenshotDir}/${label}.png`;
    try {
      await shoot(page, path);
      screenshots.push(path);
    } catch {
      // A screenshot failure must never decide the outcome.
    }
  };

  await shot('before');

  const frames = await readFrames(page);

  // 1. Challenge check FIRST, across the page and every same-origin frame.
  //    Any hit stops the attempt. We never try to solve or bypass one.
  for (const ff of frames) {
    const challenge = detectChallenge(ff.html, ff.text);
    if (challenge) {
      return { outcome: { status: 'needs_manual', reason: 'captcha' }, screenshots, detail: challenge };
    }
  }

  // A cross-origin iframe on the contact page is a third-party form host; we do
  // not reach into it, and if no local form matches we hand it to a human below.
  const picked = pickForm(frames, ctx.expectedFieldNames);
  if (!picked) {
    return { outcome: { status: 'needs_manual', reason: 'form not found in the rendered page' }, screenshots };
  }
  if (!picked.form.hasSubmit) {
    return { outcome: { status: 'needs_manual', reason: 'no submit button found' }, screenshots };
  }

  // 2. Build the plan. Refusals (phone required, marketing consent, unknown
  //    required fields) come back as needs_manual with a reason.
  const message = composeMessage(ctx.body, ctx.brandName, ctx.brandSite);
  const mapping = planFields(picked.form.fields, picked.form.checkboxes, { ...ctx, message });
  if (mapping.needsManual) {
    return { outcome: { status: 'needs_manual', reason: mapping.needsManual.reason }, screenshots };
  }
  const tooLong = lengthLimitRefusal(mapping.plan);
  if (tooLong) return { outcome: { status: 'needs_manual', reason: tooLong }, screenshots };

  // 3. Fill. Typed at a human-ish pace; nothing is clicked that was not planned.
  const frame = picked.frame;
  for (const step of mapping.plan) {
    if (step.value === null) continue;
    const marker = (step.field as MarkedField).marker;
    const locator = frame.locator(`[data-cd-field="${marker}"]`);
    try {
      if (step.field.type === 'select') await locator.selectOption({ label: step.value });
      else await locator.fill(step.value);
    } catch (error) {
      return {
        outcome: { status: 'needs_manual', reason: `could not fill field ${step.field.name}` },
        screenshots,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  for (const cb of mapping.checkboxes) {
    if (!cb.tick) continue;
    try {
      await frame.locator(`[data-cd-field="${(cb.checkbox as MarkedCheckbox).marker}"]`).check();
    } catch {
      return { outcome: { status: 'needs_manual', reason: `could not tick required consent ${cb.checkbox.name}` }, screenshots };
    }
  }

  // 4. Submit and wait for whatever the site does next.
  const urlBefore = page.url();
  try {
    await Promise.all([
      page.waitForLoadState('load', { timeout: 20_000 }).catch(() => undefined),
      frame.locator(`[data-cd-submit="${picked.form.marker}"]`).click({ timeout: 10_000 }),
    ]);
  } catch (error) {
    return {
      outcome: { status: 'needs_manual', reason: 'submit click failed' },
      screenshots,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  // Many forms post over XHR and swap the markup in without a navigation.
  await page.waitForTimeout(3_000);

  // 5. Decide from evidence only.
  const evidence = await gatherEvidence(page, urlBefore, picked.form.marker);
  await shot('after');
  return { outcome: decideOutcome(evidence), screenshots, detail: `url=${evidence.url} formPresent=${evidence.formStillPresent}` };
}

const SUCCESS_SELECTORS = [
  '.wpcf7-mail-sent-ok', '.wpcf7-response-output.wpcf7-mail-sent-ok',
  '[role=status]', '.form-success', '.success-message', '.thank-you', '.thankyou',
  '.gform_confirmation_message', '.hs-form__success', '.frm_message', '.nf-response-msg',
  '[data-form-success]',
];

export async function gatherEvidence(page: Page, urlBefore: string, formMarker: string): Promise<SubmitEvidence> {
  const url = page.url();
  let text = '';
  let formStillPresent = false;
  let successElement = false;
  for (const frame of sameOriginFrames(page)) {
    try {
      text += '\n' + ((await frame.evaluate('document.body ? document.body.innerText : ""')) as string);
      if (await frame.locator(`[data-cd-form="${formMarker}"]`).count()) formStillPresent = true;
      for (const sel of SUCCESS_SELECTORS) {
        const loc = frame.locator(sel);
        if ((await loc.count()) && (await loc.first().isVisible().catch(() => false))) {
          const inner = (await loc.first().innerText().catch(() => '')) || '';
          // An empty [role=status] placeholder proves nothing.
          if (inner.trim().length > 2) { successElement = true; break; }
        }
      }
    } catch {
      // Frame gone: treat as no evidence from it.
    }
  }
  return { navigated: url !== urlBefore, url, text, formStillPresent, successElement };
}
