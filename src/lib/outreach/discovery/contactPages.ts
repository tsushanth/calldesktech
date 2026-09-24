import { politeFetchText, sleep } from './http';

// Looks for a publicly listed contact email on the agency's OWN website
// (homepage, /contact, /about). No paid enrichment, no guessing addresses.
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
  return [...found].filter((e) => e.split('@')[1].replace(/^www\./, '') === domain);
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
    if (email) return { status: 'found', email, sourceUrl: url };
    const f = detectContactForm(res.text, url);
    if (f && (!contactForm || (contactForm.method === 'embedded' && f.method !== 'embedded'))) contactForm = f;
  }
  return contactForm
    ? { status: 'form_only', email: null, sourceUrl: contactForm.pageUrl, form: contactForm }
    : { status: 'none', email: null, sourceUrl: null };
}
