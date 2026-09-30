import { politeFetchText, sleep } from './http';

// Looks for a publicly listed contact email AND phone number on the agency's
// OWN website (homepage, /contact, /about). No paid enrichment, no guessing.
// Honors robots.txt for the paths it requests. A page with only a form
// yields status 'form_only' so a human can use the form instead.

export interface ContactForm {
  pageUrl: string; // the page the form is on (what a human or browser opens)
  action: string | null; // form action, resolved; informational only
  method: string;
  fields: { name: string; type: string; required: boolean }[];
  captcha: boolean; // reCAPTCHA / hCaptcha / Turnstile present: never automate these
  embedded?: string; // third-party form host when the form is an embedded iframe (rendered client-side)
}

export interface ContactResult {
  status: 'found' | 'form_only' | 'none';
  email: string | null;
  phone: string | null; // E.164 format, e.g. +15550147
  sourceUrl: string | null;
  form?: ContactForm;
}

const CAPTCHA_RE = /g-recaptcha|recaptcha\/api|hcaptcha|cf-turnstile|turnstile\/v0|captcha/i;
const EMBED_HOSTS = /<iframe[^>]+src=["']([^"']*(?:jotform|typeform|hubspot|formstack|wufoo|gravityforms|cognitoforms|123formbuilder|calendly|nexhealth|weave|lighthouse360|patientprism)[^"']*)["']/i;

/** Finds the best real contact form (one with a free-text message field) on a page. Static HTML only. */
export function detectContactForm(html: string, pageUrl: string): ContactForm | null {
  const captcha = CAPTCHA_RE.test(html);
  let best: { form: ContactForm; score: number } | null = null;
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1];
    const inner = m[2];
    if (/role=["']search["']|class=["'][^"']*search|name=["']s["']|type=["']search["']|login|signin|password/i.test(attrs + inner.slice(0, 400))) continue;
    const fields: ContactForm['fields'] = [];
    for (const f of inner.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const type = f[1].toLowerCase() === 'input' ? (/type=["']?([a-z]+)/i.exec(f[2])?.[1] ?? 'text').toLowerCase() : f[1].toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'checkbox', 'radio'].includes(type)) continue;
      const name = /name=["']([^"']+)["']/i.exec(f[2])?.[1] ?? /id=["']([^"']+)["']/i.exec(f[2])?.[1];
      if (!name) continue;
      fields.push({ name, type, required: /\brequired\b|aria-required=["']true/i.test(f[2]) });
    }
    const hasMessage = fields.some((f) => f.type === 'textarea');
    const hasEmail = fields.some((f) => f.type === 'email' || /e-?mail/i.test(f.name));
    if (!hasMessage || !hasEmail) continue;
    const action = /action=["']([^"']*)["']/i.exec(attrs)?.[1] ?? null;
    let resolved: string | null = null;
    try { resolved = action ? new URL(action, pageUrl).toString() : null; } catch { resolved = null; }
    const score = fields.length;
    if (!best || score > best.score) {
      best = { form: { pageUrl, action: resolved, method: (/method=["']([a-z]+)/i.exec(attrs)?.[1] ?? 'get').toLowerCase(), fields, captcha }, score };
    }
  }
  if (best) return best.form;
  const emb = EMBED_HOSTS.exec(html);
  if (emb) return { pageUrl, action: null, method: 'embedded', fields: [], captcha, embedded: emb[1].slice(0, 200) };
  return null;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JUNK_LOCALPARTS = ['noreply', 'no-reply', 'donotreply', 'privacy', 'abuse', 'postmaster', 'webmaster', 'unsubscribe', 'legal', 'careers', 'jobs', 'press'];
const JUNK_DOMAINS = ['example.com', 'sentry.io', 'wixpress.com', 'godaddy.com', 'domain.com', 'email.com', 'yourdomain.com'];
const PREFERRED = ['partners', 'partnership', 'hello', 'hi', 'contact', 'info', 'sales', 'team', 'support'];
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

// Phone patterns we accept: tel: links, US-formatted, and international with + prefix.
// We normalise everything to E.164-ish (digits only, optionally leading +).
const PHONE_RE_TEL = /href=["']tel:([^"']+)["']/gi;
const PHONE_RE_US = /\(?\d{3}\)?[\s.\-–/]*\d{3}[\s.\-–/]*\d{4}(?:\s*(?:ext|x)\.?\s*\d{1,5})?/gi;
const PHONE_RE_INTL = /\+\d[\s\d\-–().]{6,20}\d/gi;
const PHONE_JUNK = /(?:fax|efax|toll[\s\-]*free|1[\s\-]*800[\s\-]*\d{3}[\s\-]*\d{4})/i; // skip toll-free / fax lines

/** True for a plausible North American number: NXX-NXX-XXXX, no 555/all-same-digit/placeholder patterns. */
function isPlausibleNanp(d: string): boolean {
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return false;
  if (d.slice(1, 3) === '11') return false; // N11 service codes are never area codes
  if (/^(\d)\1{9}$/.test(d) || d.slice(3, 6) === '555' || d.slice(3) === '0000000') return false;
  return true;
}

/**
 * Normalise a scraped phone number. US/CA numbers come back as 10 digits and MUST be a plausible
 * NANP number (this is what rejects Unix timestamps, IDs and license numbers that happen to be
 * ten digits). International numbers need an explicit + and 8-15 digits. Returns null if unusable.
 */
function normalisePhone(raw: string): string | null {
  const intl = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (intl) {
    if (digits.length === 11 && digits[0] === '1') return isPlausibleNanp(digits.slice(1)) ? digits.slice(1) : null;
    return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
  }
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  return isPlausibleNanp(digits) ? digits : null;
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ');
}

/** Extract phone numbers from raw HTML. Returns unique normalised numbers. */
export function extractPhones(html: string): string[] {
  const found = new Set<string>();
  // tel: links are the most reliable.
  for (const m of html.matchAll(PHONE_RE_TEL)) {
    const n = normalisePhone(decodeURIComponent(m[1]));
    if (n) found.add(n);
  }
  // US-formatted numbers, from visible text only (never attributes/scripts/JSON, where 10-digit
  // timestamps and IDs live) and never as a slice of a longer digit run.
  const text = visibleText(html);
  for (const m of text.matchAll(PHONE_RE_US)) {
    if (PHONE_JUNK.test(m[0])) continue;
    const i = m.index ?? 0;
    if (/\d/.test(text[i - 1] ?? ' ') || /\d/.test(text[i + m[0].length] ?? ' ')) continue;
    const n = normalisePhone(m[0]);
    if (n) found.add(n);
  }
  // International with +.
  for (const m of text.matchAll(PHONE_RE_INTL)) {
    const n = normalisePhone(m[0]);
    if (n) found.add(n);
  }
  return [...found];
}

/** Pick the best phone number: a single US 10-digit if present, else the first in page order. */
export function pickBestPhone(phones: string[]): string | null {
  if (!phones.length) return null;
  const us10 = phones.filter((p) => p.length === 10);
  if (us10.length === 1) return us10[0];
  if (us10.length > 1) return us10[0]; // page order: the header/contact number normally comes first
  return phones[0];
}

function disallowedPaths(robots: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') applies = value === '*';
    else if (applies && key === 'disallow' && value) out.push(value);
  }
  return out;
}

export function extractEmails(html: string, domain: string): string[] {
  const decoded = html.replace(/&#64;|&commat;|\[at\]|\(at\)/gi, '@');
  const found = new Set<string>();
  for (const m of decoded.match(EMAIL_RE) || []) {
    // mailto:%20info@x.com matches the regex with its percent-encoded space attached; strip it.
    const email = m.toLowerCase().replace(/^mailto:/, '').replace(/^(%[0-9a-f]{2})+/, '');
    if (IMAGE_EXT.test(email)) continue;
    const [local, host] = email.split('@');
    if (!local || !host || JUNK_DOMAINS.some((d) => host.endsWith(d))) continue;
    if (JUNK_LOCALPARTS.some((j) => local.startsWith(j))) continue;
    found.add(email);
  }
  // Only accept addresses on the agency's own domain, never a third party's.
  // The regex captures a "www." host as part of the address, so normalize it to the
  // bare domain instead of returning it verbatim: an unroutable local@www.host bounces.
  return [...found]
    .map((e) => {
      const at = e.lastIndexOf('@');
      const host = e.slice(at + 1);
      return host.replace(/^www\./, '') === domain ? `${e.slice(0, at)}@${domain}` : null;
    })
    .filter((e): e is string => e !== null);
}

export function pickBest(emails: string[]): string | null {
  if (!emails.length) return null;
  for (const p of PREFERRED) {
    const hit = emails.find((e) => e.split('@')[0] === p);
    if (hit) return hit;
  }
  return emails[0];
}

export async function findContact(domain: string): Promise<ContactResult> {
  const base = `https://${domain}`;
  const robots = await politeFetchText(`${base}/robots.txt`, 6000);
  const blocked = robots.ok ? disallowedPaths(robots.text) : [];
  const allowed = (path: string) => !blocked.some((b) => b === '/' || path.startsWith(b));

  let contactForm: ContactForm | null = null;
  for (const path of ['/contact', '/contact-us', '/about', '/']) {
    if (!allowed(path)) continue;
    const url = `${base}${path}`;
    const res = await politeFetchText(url);
    await sleep(800);
    if (!res.ok) continue;

    const email = pickBest(extractEmails(res.text, domain));
    const phones = extractPhones(res.text);
    const phone = pickBestPhone(phones);
    if (email) return { status: 'found', email, phone, sourceUrl: url };
    if (phone) return { status: 'found', email: null, phone, sourceUrl: url };
    const f = detectContactForm(res.text, url);
    if (f && (!contactForm || (contactForm.method === 'embedded' && f.method !== 'embedded'))) contactForm = f;
  }
  return contactForm
    ? { status: 'form_only', email: null, phone: null, sourceUrl: contactForm.pageUrl, form: contactForm }
    : { status: 'none', email: null, phone: null, sourceUrl: null };
}
