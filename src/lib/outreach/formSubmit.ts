// Pure decision logic for human-triggered contact-form submission.
//
// Everything in this file is side-effect free and unit-tested: field mapping,
// captcha/challenge detection, success evidence, status transitions. The
// Playwright worker (harness/outreach/form-submit.ts) is a thin driver that
// reads the DOM into these shapes, applies the plan, and writes the status
// back. Keeping the judgment here means the rules that decide "do not touch
// this form" are testable without a browser.
//
// Two product rules this module exists to enforce:
//   1. Nothing is ever submitted unless a human moved the lead to 'queued'
//      by clicking "Submit for me" in the admin queue.
//   2. A captcha or any other bot challenge is never solved or bypassed.
//      It is an immediate stop with status 'needs_manual', reason 'captcha'.

export type FormOutreachStatus =
  | 'ready'
  | 'queued'
  | 'submitting'
  | 'submitted'
  | 'needs_manual'
  | 'failed'
  | 'replied'
  | 'skipped';

export const FORM_OUTREACH_STATUSES: readonly FormOutreachStatus[] = [
  'ready', 'queued', 'submitting', 'submitted', 'needs_manual', 'failed', 'replied', 'skipped',
] as const;

export interface FormAttempt {
  at: string;
  outcome: 'submitted' | 'needs_manual' | 'failed';
  reason?: string;
  screenshot?: string;
}

/* ------------------------------------------------------------------ *
 * Status transitions
 * ------------------------------------------------------------------ */

export type FormOutreachAction = 'queue' | 'retry';

// 'queue' is the human's "Submit for me" click. 'retry' re-queues something the
// worker could not finish. A lead that is already 'submitted' is terminal for
// submission (one submission per lead, ever) -- only a reply can move it on.
const QUEUEABLE_FROM: FormOutreachStatus[] = ['ready', 'needs_manual'];
const RETRYABLE_FROM: FormOutreachStatus[] = ['failed', 'needs_manual'];

// Statuses a human may set directly from the queue UI. 'submitting' is the
// worker's own lock and is never settable by hand; 'queued' goes through the
// 'queue' action so the confirm dialog is the only way in.
const MANUAL_STATUSES: FormOutreachStatus[] = ['ready', 'submitted', 'replied', 'skipped', 'needs_manual'];

export function canApplyAction(action: FormOutreachAction, current: FormOutreachStatus): boolean {
  if (action === 'queue') return QUEUEABLE_FROM.includes(current);
  if (action === 'retry') return RETRYABLE_FROM.includes(current);
  return false;
}

export function canSetStatus(next: FormOutreachStatus, current: FormOutreachStatus): boolean {
  if (!MANUAL_STATUSES.includes(next)) return false;
  // Never silently re-open a lead the practice was already contacted through.
  if (current === 'submitted' && next !== 'replied') return false;
  // Do not yank a lead out from under an in-flight worker attempt.
  if (current === 'submitting') return false;
  return true;
}

/** True when the worker is allowed to pick this lead up. */
export function isWorkerEligible(status: FormOutreachStatus, auto = false): boolean {
  return status === 'queued' || (auto && status === 'ready');
}

/* ------------------------------------------------------------------ *
 * Captcha / bot-challenge detection
 * ------------------------------------------------------------------ */

// Widget markers (class names, script hosts, iframe sources) and the plain-text
// prompts humans see. Anything matching means STOP -- we do not solve these.
const CHALLENGE_MARKERS: { re: RegExp; label: string }[] = [
  { re: /g-recaptcha|grecaptcha|recaptcha\/api|recaptcha\/enterprise|www\.google\.com\/recaptcha/i, label: 'recaptcha' },
  { re: /h-captcha|hcaptcha\.com|js\.hcaptcha/i, label: 'hcaptcha' },
  { re: /cf-turnstile|challenges\.cloudflare\.com|turnstile\/v0/i, label: 'turnstile' },
  { re: /funcaptcha|arkoselabs|geetest|friendly-?challenge|altcha|mtcaptcha|keycaptcha|solvemedia/i, label: 'captcha widget' },
  // Catch-all, substring on purpose: 'captcha_code', 'nocaptcha', 'captchaResponse'
  // are all captchas. Erring towards needs_manual is the safe direction here.
  { re: /captcha/i, label: 'captcha' },
];

const CHALLENGE_TEXT = /verify (?:that )?you (?:are|'re) (?:a )?human|are you a human|prove you(?:'re| are) (?:not a robot|human)|i'?m not a robot|security check|bot protection|human verification|checking your browser/i;

/**
 * Looks for any captcha or bot challenge in the rendered markup (page plus any
 * same-origin frames) and its visible text. Returns a short reason label, or
 * null when the form is clean. Honeypots are NOT challenges: a hidden decoy
 * field is simply left empty (see planFields).
 */
export function detectChallenge(markup: string, visibleText = ''): string | null {
  for (const m of CHALLENGE_MARKERS) if (m.re.test(markup)) return m.label;
  if (CHALLENGE_TEXT.test(visibleText) || CHALLENGE_TEXT.test(markup)) return 'bot challenge';
  return null;
}

/* ------------------------------------------------------------------ *
 * Field mapping
 * ------------------------------------------------------------------ */

export type FieldRole =
  | 'name' | 'first_name' | 'last_name' | 'email' | 'phone'
  | 'subject' | 'message' | 'company' | 'website' | 'honeypot' | 'optional_other' | 'unknown';

export interface FieldDescriptor {
  /** name attribute, or id when there is no name (mirrors detectContactForm). */
  name: string;
  /** 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'checkbox' | ... */
  type: string;
  required: boolean;
  label?: string;
  placeholder?: string;
  id?: string;
  /** Rendered-DOM only: the field is not visible (honeypot / leftover). */
  hidden?: boolean;
}

export interface CheckboxDescriptor {
  name: string;
  required: boolean;
  label?: string;
  id?: string;
  hidden?: boolean;
  checked?: boolean;
}

export interface FieldPlan {
  field: FieldDescriptor;
  role: FieldRole;
  /** null means: leave this field alone. */
  value: string | null;
}

export interface CheckboxPlan {
  checkbox: CheckboxDescriptor;
  /** true = tick it (required consent/terms only). false = leave it untouched. */
  tick: boolean;
  kind: 'terms' | 'marketing' | 'other';
}

export interface MappingContext {
  email: string;
  subject: string;
  message: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  websiteUrl?: string;
}

export interface MappingResult {
  plan: FieldPlan[];
  checkboxes: CheckboxPlan[];
  /** Set when the form must not be submitted by the worker. */
  needsManual: { reason: string } | null;
}

export const DEFAULT_FULL_NAME = 'Sushanth & Deepika (Calldesk)';
export const DEFAULT_FIRST_NAME = 'Sushanth';
export const DEFAULT_LAST_NAME = 'Tiruvaipati';

// Matched against name + id + label + placeholder, lowercased.
const ROLE_PATTERNS: { role: FieldRole; re: RegExp }[] = [
  { role: 'email', re: /e-?mail|\bmail\b/ },
  { role: 'phone', re: /phone|\btel\b|telephone|mobile|cell|contact number/ },
  { role: 'first_name', re: /first[\s_-]*name|\bfname\b|given[\s_-]*name|name[\s_-]*first/ },
  { role: 'last_name', re: /last[\s_-]*name|\blname\b|surname|family[\s_-]*name|name[\s_-]*last/ },
  { role: 'company', re: /company|business|organi[sz]ation|practice[\s_-]*name|firm/ },
  { role: 'website', re: /website|\burl\b|\bsite\b|web[\s_-]*address/ },
  { role: 'subject', re: /subject|\btopic\b|regarding|reason for|how can we help|inquiry[\s_-]*type/ },
  { role: 'message', re: /message|comment|enquiry|inquiry|question|details|how can we|tell us|note/ },
  { role: 'name', re: /\bname\b|your[\s_-]*name|full[\s_-]*name|contact[\s_-]*name/ },
];

// Fields a contact form may require that we cannot answer truthfully or safely.
// These do not block on their own unless required (see planFields).
const HONEYPOT_NAMES = /honey|hpot|^hp$|_hp$|bot[\s_-]*field|leave[\s_-]*(this|it)[\s_-]*blank|do[\s_-]*not[\s_-]*fill|nospam|antispam/i;

function haystack(f: { name: string; id?: string; label?: string; placeholder?: string }): string {
  return [f.name, f.id, f.label, f.placeholder].filter(Boolean).join(' ').toLowerCase();
}

export function classifyField(f: FieldDescriptor): FieldRole {
  if (f.hidden || HONEYPOT_NAMES.test(f.name) || (f.id && HONEYPOT_NAMES.test(f.id))) return 'honeypot';
  if (f.type === 'textarea') return 'message';
  if (f.type === 'email') return 'email';
  if (f.type === 'tel') return 'phone';
  const h = haystack(f);
  for (const p of ROLE_PATTERNS) if (p.re.test(h)) return p.role;
  return 'unknown';
}

const MARKETING_RE = /newsletter|subscribe|marketing|promotion|offers|updates|mailing list|keep me (?:posted|informed)|opt[\s_-]*in/i;
const TERMS_RE = /terms|privacy|policy|consent|agree|gdpr|data protection|i understand|acknowledg/i;

export function classifyCheckbox(c: CheckboxDescriptor): 'terms' | 'marketing' | 'other' {
  const h = haystack(c);
  // Marketing wins over terms: "I agree to receive marketing updates" is an
  // opt-in dressed as a consent box and must never be ticked automatically.
  if (MARKETING_RE.test(h)) return 'marketing';
  if (TERMS_RE.test(h)) return 'terms';
  return 'other';
}

/** The message we actually put in the textarea: draft body + opt-out + who we are. */
export function composeMessage(body: string, brand = 'Calldesk', site = 'calldesk.tech'): string {
  return `${body.trimEnd()}\n\nNot relevant? Reply STOP and we will not contact you again.\n${brand} (${site})`;
}

/**
 * Builds the fill plan, or refuses. Refusals (needsManual) happen when:
 *   - a phone number is required (we never supply one)
 *   - a required checkbox is a marketing opt-in
 *   - required fields we cannot recognise are present
 *   - the form has no free-text message field to put the draft in
 */
export function planFields(
  fields: FieldDescriptor[],
  checkboxes: CheckboxDescriptor[],
  ctx: MappingContext,
): MappingResult {
  const fullName = ctx.fullName ?? DEFAULT_FULL_NAME;
  const firstName = ctx.firstName ?? DEFAULT_FIRST_NAME;
  const lastName = ctx.lastName ?? DEFAULT_LAST_NAME;

  const plan: FieldPlan[] = [];
  const unknownRequired: string[] = [];
  let phoneRequired = false;
  let hasMessage = false;

  const roles = fields.map((f) => ({ f, role: classifyField(f) }));
  const splitName = roles.some((r) => r.role === 'first_name') || roles.some((r) => r.role === 'last_name');

  for (const { f, role } of roles) {
    let value: string | null = null;
    switch (role) {
      case 'honeypot':
        value = null; // deliberately left empty; a honeypot is not a challenge
        break;
      case 'email':
        value = ctx.email;
        break;
      case 'phone':
        // Never invent a phone number. A required one is a human's job.
        if (f.required && !f.hidden) phoneRequired = true;
        value = null;
        break;
      case 'first_name':
        value = firstName;
        break;
      case 'last_name':
        value = lastName;
        break;
      case 'name':
        value = splitName ? null : fullName;
        break;
      case 'subject':
        // A <select> subject/topic is picked in the browser from real options.
        value = f.type === 'select' ? null : ctx.subject;
        break;
      case 'message':
        value = ctx.message;
        hasMessage = true;
        break;
      case 'company':
        value = ctx.companyName ?? 'Calldesk';
        break;
      case 'website':
        value = ctx.websiteUrl ?? 'https://calldesk.tech';
        break;
      default:
        value = null;
        if (f.required && !f.hidden) unknownRequired.push(f.name);
        break;
    }
    // A required select we have no answer for is also a human's job.
    if (value === null && f.required && !f.hidden && (role === 'subject' || role === 'name') && f.type === 'select') {
      unknownRequired.push(f.name);
    }
    plan.push({ field: f, role, value });
  }

  const checkboxPlans: CheckboxPlan[] = [];
  let marketingRequired = false;
  for (const c of checkboxes) {
    const kind = classifyCheckbox(c);
    if (c.required && !c.hidden && kind === 'marketing') marketingRequired = true;
    // Only clearly required terms/privacy acknowledgements get ticked. Never a
    // marketing opt-in, never an optional box we were not asked about.
    checkboxPlans.push({ checkbox: c, tick: kind === 'terms' && c.required && !c.hidden && !c.checked, kind });
  }

  let needsManual: { reason: string } | null = null;
  if (marketingRequired) needsManual = { reason: 'required marketing opt-in' };
  else if (phoneRequired) needsManual = { reason: 'phone required' };
  else if (unknownRequired.length) needsManual = { reason: `unrecognised required fields: ${[...new Set(unknownRequired)].join(', ')}` };
  else if (!hasMessage) needsManual = { reason: 'no message field found' };

  return { plan, checkboxes: checkboxPlans, needsManual };
}

/* ------------------------------------------------------------------ *
 * Success evidence
 * ------------------------------------------------------------------ */

const SUCCESS_TEXT = /thank you|thanks for (?:your|getting|reaching|contacting)|message (?:has been )?(?:sent|received|submitted)|we(?:'| ha)ve received|submission received|form submitted|we will (?:be in touch|get back to you)|we'll (?:be in touch|get back to you)|successfully (?:sent|submitted)|your (?:message|request|enquiry|inquiry) (?:is|was|has been)/i;
const SUCCESS_URL = /\/(?:thank[-_]?you|thanks|success|message[-_]?sent|form[-_]?sent|confirmation|submitted)\b|[?&](?:submitted|success|sent|form_sent)=(?:1|true|yes)|#(?:thank[-_]?you|success|sent)/i;
const ERROR_TEXT = /(?:please|you must) (?:fill|complete|enter|correct|check)|is required\b|required field|invalid (?:email|phone|entry|input)|error (?:occurred|submitting)|could not (?:be )?(?:send|sent|submit)|failed to send|something went wrong|try again/i;

export function looksLikeSuccessText(text: string): boolean {
  return SUCCESS_TEXT.test(text);
}

export function looksLikeSuccessUrl(url: string): boolean {
  return SUCCESS_URL.test(url);
}

export function looksLikeErrorText(text: string): boolean {
  return ERROR_TEXT.test(text);
}

export interface SubmitEvidence {
  /** The browser navigated away from the contact page. */
  navigated: boolean;
  /** URL after submitting. */
  url: string;
  /** Visible text of the page after submitting. */
  text: string;
  /** The form we filled is still in the DOM. */
  formStillPresent: boolean;
  /** A role=status / .success / .wpcf7-mail-sent-ok style element appeared. */
  successElement: boolean;
}

export type Outcome =
  | { status: 'submitted' }
  | { status: 'needs_manual'; reason: string };

/**
 * Decides the outcome from evidence ONLY. 'submitted' requires positive proof:
 *   - navigation to a success URL or a page whose text confirms receipt, or
 *   - the form disappeared AND confirmation text is on the page, or
 *   - an explicit success element appeared.
 * Anything else -- including a silent page that simply did not complain -- is
 * 'needs_manual' with reason 'unconfirmed', for a human to verify. We never
 * guess that a submission worked.
 */
export function decideOutcome(ev: SubmitEvidence): Outcome {
  const successText = looksLikeSuccessText(ev.text);
  const errorText = looksLikeErrorText(ev.text);

  if (ev.navigated && (looksLikeSuccessUrl(ev.url) || successText)) return { status: 'submitted' };
  // An error message next to a still-present form means the fill was rejected.
  if (errorText && ev.formStillPresent && !successText && !ev.successElement) {
    return { status: 'needs_manual', reason: 'form rejected the submission' };
  }
  if (!ev.formStillPresent && successText) return { status: 'submitted' };
  if (ev.successElement && !errorText) return { status: 'submitted' };
  return { status: 'needs_manual', reason: 'unconfirmed' };
}

/* ------------------------------------------------------------------ *
 * Reply-to address
 * ------------------------------------------------------------------ */

/** "Calldesk <outreach@send.calldesk.tech>" -> "outreach@send.calldesk.tech" */
export function emailAddressPart(from: string): string | null {
  const angled = /<([^>]+)>/.exec(from);
  const raw = (angled ? angled[1] : from).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null;
}

/**
 * The address we put in the form's email field: the brand's reply-to if set,
 * otherwise the address part of the From address. Never a prospect's address.
 */
export function resolveReplyToEmail(env: Record<string, string | undefined>): string | null {
  const replyTo = env.OUTREACH_REPLYTO_EMAIL && emailAddressPart(env.OUTREACH_REPLYTO_EMAIL);
  if (replyTo) return replyTo;
  return (env.OUTREACH_FROM_EMAIL && emailAddressPart(env.OUTREACH_FROM_EMAIL)) || null;
}

/* ------------------------------------------------------------------ *
 * Suppression / eligibility
 * ------------------------------------------------------------------ */

export function domainOfEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const host = email.slice(at + 1).trim().toLowerCase().replace(/^www\./, '');
  return host || null;
}

export interface LeadEligibility {
  status: FormOutreachStatus;
  domain: string | null;
  regionBlocked?: boolean | null;
  repliedAt?: string | null;
  hasContactForm: boolean;
  /** contactForm.captcha from static detection. */
  staticCaptcha?: boolean;
  /** contactForm.method === 'embedded' (third-party iframe, cross-origin). */
  embedded?: boolean;
}

/** Why the worker must skip this lead, or null when it may proceed. */
export function skipReason(lead: LeadEligibility, suppressedDomains: Set<string>, opts: { auto?: boolean } = {}): string | null {
  if (!isWorkerEligible(lead.status, opts.auto)) return `status is ${lead.status}, not ${opts.auto ? 'queued or ready' : 'queued'}`;
  if (!lead.hasContactForm) return 'no contact form on the lead';
  if (lead.regionBlocked) return 'lead is region blocked';
  if (lead.repliedAt) return 'lead already replied';
  const domain = lead.domain?.toLowerCase().replace(/^www\./, '') ?? null;
  if (domain && suppressedDomains.has(domain)) return 'domain is suppressed';
  return null;
}

/**
 * A lead whose statically detected form already showed a captcha, or that is a
 * third-party embed we cannot read, goes straight to needs_manual without
 * opening a browser at all.
 */
export function preflightNeedsManual(lead: LeadEligibility): string | null {
  if (lead.staticCaptcha) return 'captcha';
  if (lead.embedded) return 'third-party embedded form';
  return null;
}

/* ------------------------------------------------------------------ *
 * Caps and pacing
 * ------------------------------------------------------------------ */

export const DEFAULT_MAX_PER_DAY = 15;
export const MAX_PER_HOUR = 5;
export const PER_DOMAIN_PER_DAY = 1;
/** Consecutive failed/unconfirmed attempts that stop a run outright. */
export const CIRCUIT_BREAKER_FAILURES = 5;
export const MIN_DELAY_MS = 20_000;
export const MAX_DELAY_MS = 40_000;

export function resolveDailyCap(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_PER_DAY;
  return Math.min(50, Math.max(0, Math.floor(n)));
}

/** Random 20-40 s human-paced gap between submissions. */
export function nextDelayMs(rand: () => number = Math.random): number {
  return MIN_DELAY_MS + Math.floor(rand() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
}

export interface DayLedger {
  /** YYYY-MM-DD the counts below belong to. */
  date: string;
  count: number;
  /** domain -> YYYY-MM-DD of its last submission attempt. */
  domains: Record<string, string>;
  /** YYYY-MM-DDTHH -> attempts in that hour, so a run cannot burst the day's budget. */
  hours?: Record<string, number>;
}

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function hourKey(now = new Date()): string {
  return now.toISOString().slice(0, 13);
}

export function emptyLedger(now = new Date()): DayLedger {
  return { date: todayKey(now), count: 0, domains: {}, hours: {} };
}

/** Rolls the ledger over at UTC midnight; domain history is kept. */
export function rollLedger(ledger: DayLedger, now = new Date()): DayLedger {
  const date = todayKey(now);
  return ledger.date === date
    ? { hours: {}, ...ledger }
    : { date, count: 0, domains: ledger.domains ?? {}, hours: {} };
}

export function capBlock(ledger: DayLedger, domain: string | null, cap: number, now = new Date()): string | null {
  const rolled = rollLedger(ledger, now);
  if (rolled.count >= cap) return `daily cap of ${cap} reached`;
  if ((rolled.hours?.[hourKey(now)] ?? 0) >= MAX_PER_HOUR) return `hourly cap of ${MAX_PER_HOUR} reached`;
  const d = domain?.toLowerCase().replace(/^www\./, '');
  if (d && rolled.domains[d] === rolled.date) return 'already submitted to this domain today';
  return null;
}

export function recordInLedger(ledger: DayLedger, domain: string | null, now = new Date()): DayLedger {
  const rolled = rollLedger(ledger, now);
  const d = domain?.toLowerCase().replace(/^www\./, '');
  const hk = hourKey(now);
  return {
    date: rolled.date,
    count: rolled.count + 1,
    domains: d ? { ...rolled.domains, [d]: rolled.date } : rolled.domains,
    hours: { ...(rolled.hours ?? {}), [hk]: (rolled.hours?.[hk] ?? 0) + 1 },
  };
}

/* ------------------------------------------------------------------ *
 * Pre-submit quality gate
 * ------------------------------------------------------------------ */

export const MIN_AUTO_SCORE = 50;
export const MIN_BODY_WORDS = 40;
export const MAX_BODY_WORDS = 160;

// Leftovers from a draft that went wrong. A message with any of these must never
// reach a practice.
const PLACEHOLDER_RE = /\bundefined\b|\bnull\b|\bNaN\b|\[[A-Za-z ]*(?:name|company|city|practice|insert|todo|placeholder)[A-Za-z ]*\]|\{\{[^}]*\}\}|<[A-Za-z ]*(?:name|company)[A-Za-z ]*>|lorem ipsum|XXXX|TBD/i;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface QualityInput {
  score: number | null;
  body: string;
  /** planFields(...).needsManual -- a form we cannot map is not gate-passable. */
  mappingNeedsManual: { reason: string } | null;
}

/**
 * A last check on the draft and the form before anything is submitted without a
 * person having read this particular message. Returns a short skip reason, or
 * null when the lead is good to go. A skip here is NOT a failure: the lead stays
 * 'ready' with skipReason recorded, so a human can still send it by hand.
 */
export function qualityGate(input: QualityInput): string | null {
  if ((input.score ?? 0) < MIN_AUTO_SCORE) return `score ${input.score ?? 0} below ${MIN_AUTO_SCORE}`;
  const words = wordCount(input.body);
  if (words < MIN_BODY_WORDS || words > MAX_BODY_WORDS) return `draft is ${words} words (want ${MIN_BODY_WORDS}-${MAX_BODY_WORDS})`;
  const placeholder = PLACEHOLDER_RE.exec(input.body);
  if (placeholder) return `draft contains placeholder text: ${placeholder[0]}`;
  if (input.mappingNeedsManual) return `form not fully mappable: ${input.mappingNeedsManual.reason}`;
  return null;
}

/* ------------------------------------------------------------------ *
 * Circuit breaker
 * ------------------------------------------------------------------ */

/**
 * Counts consecutive bad outcomes within one run. A run that keeps producing
 * failures or unconfirmed submissions is more likely broken than unlucky, and
 * stops rather than working through the queue.
 */
export class CircuitBreaker {
  private consecutive = 0;
  constructor(private readonly limit = CIRCUIT_BREAKER_FAILURES) {}

  record(outcome: FormAttempt['outcome'], reason?: string): void {
    const bad = outcome === 'failed' || (outcome === 'needs_manual' && reason === 'unconfirmed');
    this.consecutive = bad ? this.consecutive + 1 : 0;
  }

  get tripped(): boolean {
    return this.consecutive >= this.limit;
  }

  get reason(): string {
    return `${this.consecutive} consecutive failed/unconfirmed attempts`;
  }
}
