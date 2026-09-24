import { describe, it, expect } from 'vitest';
import {
  CircuitBreaker,
  DEFAULT_FULL_NAME,
  DEFAULT_MAX_PER_DAY,
  MAX_PER_HOUR,
  canApplyAction,
  canSetStatus,
  capBlock,
  classifyCheckbox,
  classifyField,
  composeMessage,
  decideOutcome,
  detectChallenge,
  domainOfEmail,
  emailAddressPart,
  emptyLedger,
  isWorkerEligible,
  nextDelayMs,
  planFields,
  preflightNeedsManual,
  qualityGate,
  recordInLedger,
  resolveDailyCap,
  resolveReplyToEmail,
  rollLedger,
  skipReason,
  wordCount,
  type CheckboxDescriptor,
  type FieldDescriptor,
  type SubmitEvidence,
} from '@/lib/outreach/formSubmit';

const f = (over: Partial<FieldDescriptor> & { name: string }): FieldDescriptor =>
  ({ type: 'text', required: false, ...over });
const cb = (over: Partial<CheckboxDescriptor> & { name: string }): CheckboxDescriptor =>
  ({ required: false, ...over });

const ctx = { email: 'hello@calldesk.tech', subject: 'Quick question', message: 'Body of the message.' };

describe('status transitions', () => {
  it('only a human click (queue) or a retry reaches queued', () => {
    expect(canApplyAction('queue', 'ready')).toBe(true);
    expect(canApplyAction('queue', 'needs_manual')).toBe(true);
    expect(canApplyAction('queue', 'submitted')).toBe(false);
    expect(canApplyAction('queue', 'submitting')).toBe(false);
    expect(canApplyAction('queue', 'queued')).toBe(false);
    expect(canApplyAction('retry', 'failed')).toBe(true);
    expect(canApplyAction('retry', 'needs_manual')).toBe(true);
    expect(canApplyAction('retry', 'ready')).toBe(false);
    expect(canApplyAction('retry', 'submitted')).toBe(false);
  });

  it('a submitted lead can only move to replied — one submission per lead ever', () => {
    expect(canSetStatus('replied', 'submitted')).toBe(true);
    expect(canSetStatus('ready', 'submitted')).toBe(false);
    expect(canSetStatus('submitted', 'submitted')).toBe(false);
    expect(canSetStatus('skipped', 'submitted')).toBe(false);
  });

  it('never lets a human set the worker-only statuses, nor touch an in-flight lead', () => {
    expect(canSetStatus('queued', 'ready')).toBe(false);
    expect(canSetStatus('submitting', 'ready')).toBe(false);
    expect(canSetStatus('failed', 'ready')).toBe(false);
    expect(canSetStatus('skipped', 'submitting')).toBe(false);
  });

  it('the worker picks up queued and nothing else', () => {
    expect(isWorkerEligible('queued')).toBe(true);
    for (const s of ['ready', 'submitting', 'submitted', 'needs_manual', 'failed', 'replied', 'skipped'] as const) {
      expect(isWorkerEligible(s)).toBe(false);
    }
  });
});

describe('captcha / bot-challenge detection', () => {
  it('finds the widgets by markup', () => {
    expect(detectChallenge('<div class="g-recaptcha" data-sitekey="x"></div>')).toBe('recaptcha');
    expect(detectChallenge('<script src="https://www.google.com/recaptcha/enterprise.js"></script>')).toBe('recaptcha');
    expect(detectChallenge('<div class="h-captcha"></div>')).toBe('hcaptcha');
    expect(detectChallenge('<div class="cf-turnstile"></div>')).toBe('turnstile');
    expect(detectChallenge('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>')).toBe('turnstile');
    expect(detectChallenge('<div id="funcaptcha"></div>')).toBe('captcha widget');
    expect(detectChallenge('<input name="captcha_code">')).toBe('captcha');
  });

  it('finds challenges stated only in visible text', () => {
    expect(detectChallenge('<p>Please verify you are human</p>', 'Please verify you are human')).toBeTruthy();
    expect(detectChallenge('<div></div>', "I'm not a robot")).toBeTruthy();
    expect(detectChallenge('<div></div>', 'Checking your browser before you continue')).toBeTruthy();
  });

  it('a clean contact form is not a challenge, and a honeypot is not one either', () => {
    expect(detectChallenge('<form><input name="email"><textarea name="msg"></textarea></form>', 'Contact us')).toBeNull();
    expect(detectChallenge('<input name="honeypot" style="display:none">', 'Contact us')).toBeNull();
  });
});

describe('field classification', () => {
  it('maps the usual suspects by type, name, label and placeholder', () => {
    expect(classifyField(f({ name: 'x', type: 'textarea' }))).toBe('message');
    expect(classifyField(f({ name: 'x', type: 'email' }))).toBe('email');
    expect(classifyField(f({ name: 'x', type: 'tel' }))).toBe('phone');
    expect(classifyField(f({ name: 'your-email' }))).toBe('email');
    expect(classifyField(f({ name: 'fld_3', label: 'Phone number' }))).toBe('phone');
    expect(classifyField(f({ name: 'fld_4', placeholder: 'First name' }))).toBe('first_name');
    expect(classifyField(f({ name: 'surname' }))).toBe('last_name');
    expect(classifyField(f({ name: 'company' }))).toBe('company');
    expect(classifyField(f({ name: 'website' }))).toBe('website');
    expect(classifyField(f({ name: 'subject' }))).toBe('subject');
    expect(classifyField(f({ name: 'your-name' }))).toBe('name');
    expect(classifyField(f({ name: 'zip_code' }))).toBe('unknown');
  });

  it('treats hidden and honeypot-named fields as honeypots', () => {
    expect(classifyField(f({ name: 'email', hidden: true }))).toBe('honeypot');
    expect(classifyField(f({ name: 'honeypot_field' }))).toBe('honeypot');
    expect(classifyField(f({ name: 'x', id: 'antispam' }))).toBe('honeypot');
  });
});

describe('planFields', () => {
  const basic = [
    f({ name: 'your-name', required: true }),
    f({ name: 'your-email', type: 'email', required: true }),
    f({ name: 'your-message', type: 'textarea', required: true }),
  ];

  it('fills name, email and the message, and leaves a honeypot empty', () => {
    const res = planFields([...basic, f({ name: 'hp_url', hidden: true })], [], ctx);
    expect(res.needsManual).toBeNull();
    const byName = Object.fromEntries(res.plan.map((p) => [p.field.name, p.value]));
    expect(byName['your-name']).toBe(DEFAULT_FULL_NAME);
    expect(byName['your-email']).toBe('hello@calldesk.tech');
    expect(byName['your-message']).toBe('Body of the message.');
    expect(byName['hp_url']).toBeNull();
  });

  it('splits the name when the form asks for first and last separately', () => {
    const res = planFields(
      [f({ name: 'first_name', required: true }), f({ name: 'last_name', required: true }), f({ name: 'name' }), ...basic.slice(1)],
      [], ctx,
    );
    const byName = Object.fromEntries(res.plan.map((p) => [p.field.name, p.value]));
    expect(byName['first_name']).toBe('Sushanth');
    expect(byName['last_name']).toBe('Tiruvaipati');
    // The combined field is left alone so the name is not duplicated.
    expect(byName['name']).toBeNull();
  });

  it('never fills a phone, and refuses when one is required', () => {
    const optional = planFields([...basic, f({ name: 'phone', type: 'tel' })], [], ctx);
    expect(optional.needsManual).toBeNull();
    expect(optional.plan.find((p) => p.field.name === 'phone')!.value).toBeNull();

    const required = planFields([...basic, f({ name: 'phone', type: 'tel', required: true })], [], ctx);
    expect(required.needsManual).toEqual({ reason: 'phone required' });
  });

  it('refuses on unrecognised required fields and lists them', () => {
    const res = planFields([...basic, f({ name: 'patient_id', required: true }), f({ name: 'appointment_date', required: true })], [], ctx);
    expect(res.needsManual!.reason).toBe('unrecognised required fields: patient_id, appointment_date');
  });

  it('refuses a form with no message field', () => {
    expect(planFields([basic[0], basic[1]], [], ctx).needsManual).toEqual({ reason: 'no message field found' });
  });

  it('ignores unrecognised fields that are optional or hidden', () => {
    const res = planFields([...basic, f({ name: 'zip' }), f({ name: 'ref', required: true, hidden: true })], [], ctx);
    expect(res.needsManual).toBeNull();
  });

  it('ticks only required terms boxes, never marketing or optional ones', () => {
    const boxes = [
      cb({ name: 'privacy', label: 'I agree to the privacy policy', required: true }),
      cb({ name: 'news', label: 'Subscribe me to the newsletter', required: false }),
      cb({ name: 'terms_optional', label: 'I agree to the terms', required: false }),
      cb({ name: 'already', label: 'I consent to the terms', required: true, checked: true }),
    ];
    const res = planFields(basic, boxes, ctx);
    expect(res.needsManual).toBeNull();
    expect(Object.fromEntries(res.checkboxes.map((c) => [c.checkbox.name, c.tick]))).toEqual({
      privacy: true, news: false, terms_optional: false, already: false,
    });
  });

  it('refuses when a REQUIRED checkbox is a marketing opt-in dressed as consent', () => {
    const res = planFields(basic, [cb({ name: 'ok', label: 'I agree to receive marketing updates', required: true })], ctx);
    expect(res.needsManual).toEqual({ reason: 'required marketing opt-in' });
  });

  it('classifies checkboxes with marketing winning over consent wording', () => {
    expect(classifyCheckbox(cb({ name: 'a', label: 'I agree to the terms of service' }))).toBe('terms');
    expect(classifyCheckbox(cb({ name: 'b', label: 'I agree to receive your newsletter' }))).toBe('marketing');
    expect(classifyCheckbox(cb({ name: 'c', label: 'Are you an existing patient?' }))).toBe('other');
  });

  it('leaves a subject <select> for the browser to choose from real options', () => {
    const res = planFields([...basic, f({ name: 'topic', type: 'select', label: 'Subject' })], [], ctx);
    expect(res.plan.find((p) => p.field.name === 'topic')!.value).toBeNull();
  });
});

describe('composeMessage', () => {
  it('appends the opt-out line and who we are', () => {
    const out = composeMessage('Hello there.');
    expect(out).toBe('Hello there.\n\nNot relevant? Reply STOP and we will not contact you again.\nCalldesk (https://calldesk.tech)');
  });
});

describe('success evidence', () => {
  const ev = (over: Partial<SubmitEvidence>): SubmitEvidence =>
    ({ navigated: false, url: 'https://x.com/contact', text: '', formStillPresent: true, successElement: false, ...over });

  it('confirms on navigation to a thank-you URL', () => {
    expect(decideOutcome(ev({ navigated: true, url: 'https://x.com/thank-you' }))).toEqual({ status: 'submitted' });
    expect(decideOutcome(ev({ navigated: true, url: 'https://x.com/contact?submitted=true' }))).toEqual({ status: 'submitted' });
  });

  it('confirms on navigation to a page whose text says it was received', () => {
    expect(decideOutcome(ev({ navigated: true, url: 'https://x.com/c2', text: 'Thanks for contacting us, we will be in touch.' })))
      .toEqual({ status: 'submitted' });
  });

  it('confirms when the form disappears and confirmation text appears', () => {
    expect(decideOutcome(ev({ formStillPresent: false, text: 'Your message has been sent.' }))).toEqual({ status: 'submitted' });
  });

  it('confirms on an explicit success element', () => {
    expect(decideOutcome(ev({ successElement: true }))).toEqual({ status: 'submitted' });
  });

  it('refuses to claim success when the evidence is ambiguous', () => {
    // Page did not complain, but never confirmed either: a human verifies.
    expect(decideOutcome(ev({}))).toEqual({ status: 'needs_manual', reason: 'unconfirmed' });
    expect(decideOutcome(ev({ navigated: true, url: 'https://x.com/contact#form' })))
      .toEqual({ status: 'needs_manual', reason: 'unconfirmed' });
    // Form vanished but said nothing: still not proof.
    expect(decideOutcome(ev({ formStillPresent: false }))).toEqual({ status: 'needs_manual', reason: 'unconfirmed' });
  });

  it('reports a validation error rather than calling it submitted', () => {
    expect(decideOutcome(ev({ text: 'Phone is required. Please fill in all fields.' })))
      .toEqual({ status: 'needs_manual', reason: 'form rejected the submission' });
  });
});

describe('reply-to resolution', () => {
  it('pulls the address out of a display-name From header', () => {
    expect(emailAddressPart('Calldesk <outreach@send.calldesk.tech>')).toBe('outreach@send.calldesk.tech');
    expect(emailAddressPart('plain@calldesk.tech')).toBe('plain@calldesk.tech');
    expect(emailAddressPart('not an address')).toBeNull();
  });

  it('prefers the reply-to, falls back to the From address part', () => {
    expect(resolveReplyToEmail({ OUTREACH_REPLYTO_EMAIL: 'hi@calldesk.tech', OUTREACH_FROM_EMAIL: 'x@send.calldesk.tech' })).toBe('hi@calldesk.tech');
    expect(resolveReplyToEmail({ OUTREACH_FROM_EMAIL: 'Calldesk <x@send.calldesk.tech>' })).toBe('x@send.calldesk.tech');
    expect(resolveReplyToEmail({})).toBeNull();
  });

  it('reads the domain out of an address', () => {
    expect(domainOfEmail('a@WWW.Example.com')).toBe('example.com');
    expect(domainOfEmail('broken')).toBeNull();
  });
});

describe('eligibility and preflight', () => {
  const lead = { status: 'queued' as const, domain: 'practice.com', hasContactForm: true };

  it('lets a clean queued lead through', () => {
    expect(skipReason(lead, new Set())).toBeNull();
  });

  it('skips anything not queued by a human', () => {
    expect(skipReason({ ...lead, status: 'ready' }, new Set())).toBe('status is ready, not queued');
    expect(skipReason({ ...lead, status: 'submitted' }, new Set())).toBe('status is submitted, not queued');
  });

  it('skips suppressed domains, region-blocked and already-replied leads', () => {
    expect(skipReason(lead, new Set(['practice.com']))).toBe('domain is suppressed');
    expect(skipReason({ ...lead, domain: 'www.practice.com' }, new Set(['practice.com']))).toBe('domain is suppressed');
    expect(skipReason({ ...lead, regionBlocked: true }, new Set())).toBe('lead is region blocked');
    expect(skipReason({ ...lead, repliedAt: '2026-09-01T00:00:00Z' }, new Set())).toBe('lead already replied');
    expect(skipReason({ ...lead, hasContactForm: false }, new Set())).toBe('no contact form on the lead');
  });

  it('sends known captchas and third-party embeds to a human without opening a browser', () => {
    expect(preflightNeedsManual({ ...lead, staticCaptcha: true })).toBe('captcha');
    expect(preflightNeedsManual({ ...lead, embedded: true })).toBe('third-party embedded form');
    expect(preflightNeedsManual(lead)).toBeNull();
  });
});

describe('caps and pacing', () => {
  it('clamps the daily cap and defaults to 15', () => {
    expect(resolveDailyCap(undefined)).toBe(DEFAULT_MAX_PER_DAY);
    expect(resolveDailyCap('nonsense')).toBe(DEFAULT_MAX_PER_DAY);
    expect(resolveDailyCap('3')).toBe(3);
    expect(resolveDailyCap('-5')).toBe(0);
    expect(resolveDailyCap('9999')).toBe(50);
  });

  it('blocks at the daily cap', () => {
    const now = new Date('2026-09-24T10:00:00Z');
    const ledger = { date: '2026-09-24', count: 15, domains: {} };
    expect(capBlock(ledger, 'a.com', 15, now)).toBe('daily cap of 15 reached');
    expect(capBlock({ ...ledger, count: 14 }, 'a.com', 15, now)).toBeNull();
  });

  it('blocks at the hourly cap without blocking the whole day', () => {
    const now = new Date('2026-09-24T10:30:00Z');
    const ledger = { date: '2026-09-24', count: 5, domains: {}, hours: { '2026-09-24T10': MAX_PER_HOUR } };
    expect(capBlock(ledger, 'a.com', 15, now)).toBe(`hourly cap of ${MAX_PER_HOUR} reached`);
    expect(capBlock(ledger, 'a.com', 15, new Date('2026-09-24T11:00:00Z'))).toBeNull();
  });

  it('allows one submission per domain per day', () => {
    const now = new Date('2026-09-24T10:00:00Z');
    let ledger = emptyLedger(now);
    expect(capBlock(ledger, 'practice.com', 15, now)).toBeNull();
    ledger = recordInLedger(ledger, 'www.practice.com', now);
    expect(ledger.count).toBe(1);
    expect(capBlock(ledger, 'practice.com', 15, now)).toBe('already submitted to this domain today');
    expect(capBlock(ledger, 'other.com', 15, now)).toBeNull();
    // Next day the domain is allowed again.
    expect(capBlock(ledger, 'practice.com', 15, new Date('2026-09-25T10:00:00Z'))).toBeNull();
  });

  it('rolls the day over but keeps domain history', () => {
    const rolled = rollLedger({ date: '2026-09-23', count: 15, domains: { 'a.com': '2026-09-23' } }, new Date('2026-09-24T00:05:00Z'));
    expect(rolled).toEqual({ date: '2026-09-24', count: 0, domains: { 'a.com': '2026-09-23' }, hours: {} });
  });

  it('paces submissions 20-40 s apart', () => {
    expect(nextDelayMs(() => 0)).toBe(20_000);
    expect(nextDelayMs(() => 0.999999)).toBeLessThanOrEqual(40_000);
    expect(nextDelayMs(() => 0.5)).toBeGreaterThanOrEqual(20_000);
  });
});

describe('quality gate', () => {
  const body = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');

  it('passes a good draft on a mappable form', () => {
    expect(qualityGate({ score: 70, body, mappingNeedsManual: null })).toBeNull();
  });

  it('holds back low scores and off-length drafts', () => {
    expect(qualityGate({ score: 49, body, mappingNeedsManual: null })).toBe('score 49 below 50');
    expect(qualityGate({ score: null, body, mappingNeedsManual: null })).toBe('score 0 below 50');
    expect(qualityGate({ score: 70, body: 'too short', mappingNeedsManual: null })).toContain('2 words');
    expect(qualityGate({ score: 70, body: `${body} ${body} ${body} ${body}`, mappingNeedsManual: null })).toContain("240 words");
  });

  it('never lets placeholder or undefined text reach a practice', () => {
    expect(qualityGate({ score: 70, body: `${body} undefined`, mappingNeedsManual: null })).toContain('placeholder text');
    expect(qualityGate({ score: 70, body: `${body} [COMPANY NAME]`, mappingNeedsManual: null })).toContain('placeholder text');
    expect(qualityGate({ score: 70, body: `${body} {{name}}`, mappingNeedsManual: null })).toContain('placeholder text');
  });

  it('holds back a form we cannot fully map', () => {
    expect(qualityGate({ score: 70, body, mappingNeedsManual: { reason: 'phone required' } }))
      .toBe('form not fully mappable: phone required');
  });

  it('counts words the obvious way', () => {
    expect(wordCount('  one  two\nthree ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });
});

describe('circuit breaker', () => {
  it('trips after five consecutive failed/unconfirmed attempts', () => {
    const b = new CircuitBreaker();
    for (let i = 0; i < 4; i++) b.record('failed');
    expect(b.tripped).toBe(false);
    b.record('needs_manual', 'unconfirmed');
    expect(b.tripped).toBe(true);
    expect(b.reason).toContain('5 consecutive');
  });

  it('resets on a confirmed submission, and a captcha refusal is not a failure', () => {
    const b = new CircuitBreaker();
    b.record('failed'); b.record('failed');
    b.record('needs_manual', 'captcha');
    expect(b.tripped).toBe(false);
    for (let i = 0; i < 4; i++) b.record('failed');
    b.record('submitted');
    for (let i = 0; i < 4; i++) b.record('failed');
    expect(b.tripped).toBe(false);
  });
});

import { isWorkerEligible as _isEligible, skipReason as _skipReason } from '@/lib/outreach/formSubmit';

describe('auto-submit mode eligibility', () => {
  const base = { domain: 'x.com', regionBlocked: false, repliedAt: null, hasContactForm: true } as Parameters<typeof _skipReason>[0];
  it('only queued is eligible by default; ready needs the auto flag', () => {
    expect(_isEligible('queued')).toBe(true);
    expect(_isEligible('ready')).toBe(false);
    expect(_isEligible('ready', true)).toBe(true);
    expect(_isEligible('submitted', true)).toBe(false);
    expect(_isEligible('needs_manual', true)).toBe(false);
  });
  it('skipReason honours the auto flag', () => {
    const ready = { ...base, status: 'ready' } as Parameters<typeof _skipReason>[0];
    expect(_skipReason(ready, new Set())).toMatch(/not queued/);
    expect(_skipReason(ready, new Set(), { auto: true })).toBeNull();
    expect(_skipReason({ ...ready, repliedAt: 'x' } as Parameters<typeof _skipReason>[0], new Set(), { auto: true })).toBe('lead already replied');
  });
});
