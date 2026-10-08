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
  DAILY_CAP_CEILING,
  addressAnswerFor,
  defaultAnswerFor,
  type PostalAddress,
  detectChallenge,
  detectSoftCaptcha,
  domainOfEmail,
  emailAddressPart,
  emptyLedger,
  isNonUsCaCountryDomain,
  isNonUsCaLead,
  isWorkerEligible,
  nextDelayMs,
  planFields,
  preflightNeedsManual,
  qualityGate,
  recordInLedger,
  resolveDailyCap,
  resolveHourlyCap,
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
  it('stops on a visible, interactive widget (v2 checkbox / hCaptcha container or anchor iframe)', () => {
    expect(detectChallenge('<div class="g-recaptcha" data-sitekey="x"></div>')).toBe('recaptcha widget');
    expect(detectChallenge('<div class="h-captcha" data-sitekey="x"></div>')).toBe('hcaptcha widget');
    expect(detectChallenge('<iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=normal"></iframe>')).toBe('recaptcha checkbox');
    expect(detectChallenge('<iframe src="https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html"></iframe>')).toBe('hcaptcha checkbox');
  });

  it('does NOT stop on a page that only loads a captcha script, an invisible widget, or the bare word (owner decision 2026-10-08)', () => {
    expect(detectChallenge('<script src="https://www.google.com/recaptcha/enterprise.js?render=KEY"></script>')).toBeNull();
    expect(detectChallenge('<script src="https://www.google.com/recaptcha/api.js?render=KEY"></script>')).toBeNull();
    expect(detectChallenge('<div class="g-recaptcha" data-size="invisible" data-sitekey="x"></div>')).toBeNull();
    expect(detectChallenge('<iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible"></iframe>')).toBeNull();
    expect(detectChallenge('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>')).toBeNull();
    expect(detectChallenge('<input name="captcha_code">')).toBeNull();
    expect(detectChallenge('<div id="funcaptcha"></div>')).toBeNull();
  });

  it('still notes those scripts as soft signals so the human sees why an unsure attempt was unsure', () => {
    expect(detectSoftCaptcha('<script src="https://www.google.com/recaptcha/api.js?render=KEY"></script>')).toBe('recaptcha script');
    expect(detectSoftCaptcha('<div class="cf-turnstile"></div>')).toBe('turnstile script');
    expect(detectSoftCaptcha('<input name="captcha_code">')).toBe('captcha word');
    expect(detectSoftCaptcha('<form><input name="email"></form>')).toBeNull();
  });

  it('finds challenges stated only in visible text', () => {
    expect(detectChallenge('<p>Please verify you are human</p>', 'Please verify you are human')).toBeTruthy();
    expect(detectChallenge('<script>var s = "security check";</script>', 'Contact us')).toBeNull(); // wording inside code is not a prompt a person sees
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
    expect(classifyField(f({ name: 'zip_code' }))).toBe('address'); // postal address parts are their own role now
    expect(classifyField(f({ name: 'budget' }))).toBe('unknown');
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

  it('refuses on required fields it must not invent (ids, numbers, dates, addresses) and lists them', () => {
    const res = planFields([...basic, f({ name: 'patient_id', required: true }), f({ name: 'appointment_date', required: true, type: 'date' })], [], ctx);
    expect(res.needsManual!.reason).toBe('unrecognised required fields: patient_id, appointment_date');
  });

  it('fills other unrecognised required fields with neutral, truthful placeholders (owner decision 2026-10-08)', () => {
    const res = planFields([...basic, f({ name: 'job_title', required: true }), f({ name: 'timeline', required: true }), f({ name: 'budget', required: true }), f({ name: 'referral', required: true }), f({ name: 'whatever', required: true })], [], ctx);
    expect(res.needsManual).toBeNull();
    const by = (n: string) => res.plan.find((x) => x.field.name === n)!.value;
    expect(by('job_title')).toBe('Co-founder');
    expect(by('timeline')).toBe('Flexible');
    expect(by('budget')).toBe('To be discussed');
    expect(by('referral')).toBe('Direct outreach');
    expect(by('whatever')).toBe('Partnership inquiry');
  });

  it('picks a real option for an unrecognised required select, preferring a neutral one, and never an address-like one', () => {
    expect(defaultAnswerFor(f({ name: 'timeline', type: 'select', required: true, options: ['Select one', 'This week', 'Flexible', 'Next year'] }))).toBe('Flexible');
    expect(defaultAnswerFor(f({ name: 'size', label: 'Company size', type: 'select', required: true, options: ['Choose', '1-10', '11-50'] }))).toBe('1-10');
    expect(defaultAnswerFor(f({ name: 'hear', label: 'How did you hear about us', type: 'select', required: true, options: ['Select', 'Google', 'Other'] }))).toBe('Other');
    expect(defaultAnswerFor(f({ name: 'state', type: 'select', required: true, options: ['Select', 'Texas', 'Ohio'] }))).toBeNull();
    expect(defaultAnswerFor(f({ name: 'x', type: 'select', required: true, options: ['Select'] }))).toBeNull();
  });

  it('uses a real phone number only when one is configured, never an invented one', () => {
    const withPhone = planFields([...basic, f({ name: 'phone', type: 'tel', required: true })], [], { ...ctx, phone: '+15551230000' });
    expect(withPhone.needsManual).toBeNull();
    expect(withPhone.plan.find((x) => x.field.name === 'phone')!.value).toBe('+15551230000');
    expect(planFields([...basic, f({ name: 'phone', type: 'tel', required: true })], [], ctx).needsManual).toEqual({ reason: 'phone required' });
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

  it('sends third-party embeds to a human without opening a browser, but lets a statically flagged captcha page be tried', () => {
    expect(preflightNeedsManual({ ...lead, staticCaptcha: true })).toBeNull(); // the crude discovery-time flag no longer stops an attempt; the live page decides
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
    expect(resolveDailyCap('9999')).toBe(DAILY_CAP_CEILING);
    expect(DAILY_CAP_CEILING).toBeGreaterThan(50);
  });

  it('reads the hourly cap and the pacing from settings', () => {
    expect(resolveHourlyCap(undefined)).toBe(MAX_PER_HOUR);
    expect(resolveHourlyCap('')).toBe(MAX_PER_HOUR);
    expect(resolveHourlyCap('40')).toBe(40);
    expect(resolveHourlyCap('0')).toBe(1);
    const ledger = { ...emptyLedger(), hours: { [new Date().toISOString().slice(0, 13)]: 10 } };
    expect(capBlock(ledger, 'a.com', 100)).toBe('hourly cap of 5 reached');
    expect(capBlock(ledger, 'a.com', 100, new Date(), 40)).toBeNull();
    expect(nextDelayMs(() => 0, 3000, 8000)).toBe(3000);
    expect(nextDelayMs(() => 0.9999, 3000, 8000)).toBeLessThanOrEqual(8000);
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

import { lengthLimitRefusal as _limit } from '@/lib/outreach/formSubmit';

describe('lengthLimitRefusal', () => {
  it('refuses a message longer than the field maxlength and passes otherwise', () => {
    const field = (maxLength?: number) => ({ field: { name: 'msg', type: 'textarea', required: true, maxLength }, role: 'message', value: 'x'.repeat(300) }) as unknown as Parameters<typeof _limit>[0][number];
    expect(_limit([field(200)])).toContain('allows 200 characters');
    expect(_limit([field(500)])).toBeNull();
    expect(_limit([field(undefined)])).toBeNull();
  });
});


describe('isNonUsCaCountryDomain (vertical outreach is US and Canada only)', () => {
  it('flags country-code domains outside the US and Canada', () => {
    for (const d of ['olivegreencareservices.co.uk', 'thefirshomecare.co.uk', 'x.com.au', 'care.nz', 'a.ie', 'b.de', 'www.c.jp']) expect(isNonUsCaCountryDomain(d)).toBe(true);
  });
  it('lets US, Canadian, generic and widely used ccTLD domains through', () => {
    for (const d of ['thekidsplaceinc.com', 'clinic.org', 'x.net', 'a.us', 'b.ca', 'app.io', 'voice.ai', 'brand.co', 'x.me', null, '']) expect(isNonUsCaCountryDomain(d as string)).toBe(false);
  });
});


describe('isNonUsCaLead (the real leads that slipped past the domain check)', () => {
  it('flags UK care agencies on plain .com domains by their location and CQC source', () => {
    expect(isNonUsCaLead({ domain: 'valleywoodcare.com', location: 'Crewe, GB', sourceKey: 'homecare:gb-cqc:1-1066318846' })).toBe(true);
    expect(isNonUsCaLead({ domain: 'kmlkare.com', location: 'Wallsend, GB' })).toBe(true);
    expect(isNonUsCaLead({ domain: 'x.com', sourceKey: 'homecare:gb-cqc:1-1' })).toBe(true);
    expect(isNonUsCaLead({ domain: 'care.co.uk' })).toBe(true);
  });
  it('lets US and Canadian leads through, including states and provinces that look like country codes', () => {
    expect(isNonUsCaLead({ domain: 'ateddybearslearningchildcarepreschool.com', location: 'Laveen, AZ', sourceKey: 'childcare:az:SGH-17816' })).toBe(false);
    for (const loc of ['Atlanta, GA', 'Chicago, IL', 'Dover, DE', 'Indianapolis, IN', 'Los Angeles, CA', 'Little Rock, AR', 'Toronto, ON', "St. John's, NL", 'Calgary, AB']) {
      expect(isNonUsCaLead({ domain: 'a.com', location: loc })).toBe(false);
    }
    expect(isNonUsCaLead({ domain: 'a.com', location: null, sourceKey: null })).toBe(false);
    expect(isNonUsCaLead({ domain: 'a.com', sourceKey: 'dental:us-npi:123' })).toBe(false);
  });
});


describe('postal address fields (the business address, only on required fields)', () => {
  const addr: PostalAddress = { line1: '5900 Balcones Drive', line2: 'Ste 100', city: 'Austin', state: 'TX', zip: '78731' };
  const base = [f({ name: 'your-name', required: true }), f({ name: 'your-email', type: 'email', required: true }), f({ name: 'message', type: 'textarea', required: true })];

  it('classifies address fields as addresses, not as a company, and leaves e-mail and web addresses alone', () => {
    expect(classifyField(f({ name: 'business_address' }))).toBe('address');
    expect(classifyField(f({ name: 'your-streetaddress01' }))).toBe('address');
    expect(classifyField(f({ name: 'x', label: 'Zip / Postal code' }))).toBe('address');
    expect(classifyField(f({ name: 'x', label: 'Country' }))).toBe('address');
    expect(classifyField(f({ name: 'x', label: 'Email address' }))).toBe('email');
    expect(classifyField(f({ name: 'website_address' }))).toBe('website');
    expect(classifyField(f({ name: 'company_name' }))).toBe('company');
  });

  it('answers each part of the address, and combines the suite into a single address box', () => {
    expect(addressAnswerFor(f({ name: 'street' }), addr, true)).toBe('5900 Balcones Drive Ste 100');
    expect(addressAnswerFor(f({ name: 'address_line_1' }), addr)).toBe('5900 Balcones Drive');
    expect(addressAnswerFor(f({ name: 'address_line_2' }), addr)).toBe('Ste 100');
    expect(addressAnswerFor(f({ name: 'city' }), addr)).toBe('Austin');
    expect(addressAnswerFor(f({ name: 'zip' }), addr)).toBe('78731');
    expect(addressAnswerFor(f({ name: 'state' }), addr)).toBe('TX');
    expect(addressAnswerFor(f({ name: 'state', type: 'select', options: ['Select', 'Ohio', 'Texas', 'Utah'] }), addr)).toBe('Texas');
    expect(addressAnswerFor(f({ name: 'country', type: 'select', options: ['Canada', 'United States of America'] }), addr)).toBe('United States of America');
    expect(addressAnswerFor(f({ name: 'city' }), undefined)).toBeNull();
  });

  it('fills required address fields when an address is configured, leaves optional ones blank, and refuses without one', () => {
    const fields = [...base, f({ name: 'street', required: true }), f({ name: 'city', required: true }), f({ name: 'state', required: true }), f({ name: 'zip', required: true }), f({ name: 'address2' })];
    const withAddr = planFields(fields, [], { ...ctx, address: addr });
    expect(withAddr.needsManual).toBeNull();
    const by = (n: string) => withAddr.plan.find((x) => x.field.name === n)!.value;
    expect([by('street'), by('city'), by('state'), by('zip')]).toEqual(['5900 Balcones Drive', 'Austin', 'TX', '78731']); // address2 exists, so no merge
    expect(by('address2')).toBeNull(); // optional: not given out
    expect(planFields(fields, [], ctx).needsManual!.reason).toMatch(/unrecognised required fields: street, city, state, zip/);
  });
});
