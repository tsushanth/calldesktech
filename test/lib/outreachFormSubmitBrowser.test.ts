import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { pickForm, submitOnPage, sameOriginFrames, type FrameForms, type ReadForm } from '@/lib/outreach/formSubmitBrowser';

// End-to-end over a real browser against a local static contact form -- no
// network, no third-party site. Chromium is NOT vendored by this repo (see the
// harness README: `npx playwright install chromium` is a one-time step on the
// mini), so when the browser binary is absent these tests skip and the
// mapping/decision logic is covered by outreachFormSubmit.test.ts instead.
let browser: Browser | null = null;
let launchError = '';

const page = (form: string, extra = '') => `<!doctype html><html><body><h1>Contact us</h1>
<form id="contact" method="post" action="/submit">${form}</form>${extra}</body></html>`;

const BASIC_FIELDS = `
  <label for="n">Your name</label><input id="n" name="your-name" required>
  <label for="e">Email</label><input id="e" name="your-email" type="email" required>
  <label for="s">Subject</label><input id="s" name="subject">
  <label for="m">Message</label><textarea id="m" name="your-message" required></textarea>
  <input type="text" name="hp_trap" style="display:none">
  <button type="submit">Send</button>`;

// Each route is one scenario the worker has to get right.
const ROUTES: Record<string, string> = {
  '/thanks': page(BASIC_FIELDS, '<p>Thank you, your message has been sent.</p>'),
  // Navigates to a thank-you page on submit.
  '/nav': page(BASIC_FIELDS).replace('action="/submit"', 'action="/thanks" method="get"'),
  // Replaces the form with confirmation text, no navigation.
  '/xhr': page(BASIC_FIELDS, `<script>
      document.getElementById('contact').addEventListener('submit', (e) => {
        e.preventDefault();
        document.getElementById('contact').remove();
        document.body.insertAdjacentHTML('beforeend', '<p>Thanks for contacting us, we will be in touch.</p>');
      });
    </script>`),
  // Submits and says nothing at all: must NOT be called submitted.
  '/silent': page(BASIC_FIELDS, `<script>
      document.getElementById('contact').addEventListener('submit', (e) => e.preventDefault());
    </script>`),
  // reCAPTCHA present: must stop before typing anything.
  '/captcha': page(`${BASIC_FIELDS}<div class="g-recaptcha" data-sitekey="abc"></div>`),
  // Required phone: a human's job.
  '/phone': page(BASIC_FIELDS.replace('<textarea', '<input name="phone" type="tel" required><textarea')),
  // Required marketing opt-in.
  '/marketing': page(`${BASIC_FIELDS}<label><input type="checkbox" name="mk" required> Send me your newsletter</label>`),
  // Required privacy consent: tickable.
  '/consent': page(`${BASIC_FIELDS}<label><input type="checkbox" name="pp" required> I agree to the privacy policy</label>`, `<script>
      document.getElementById('contact').addEventListener('submit', (e) => {
        e.preventDefault();
        document.body.insertAdjacentHTML('beforeend', '<div class="form-success">Your message has been sent.</div>');
      });
    </script>`),
};

let server: Server;
let origin = '';
let shotDir = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    const body = ROUTES[path];
    if (!body) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  shotDir = mkdtempSync(join(tmpdir(), 'cd-forms-'));
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
  } catch (error) {
    launchError = error instanceof Error ? error.message : String(error);
  }
}, 120_000);

afterAll(async () => {
  await browser?.close().catch(() => undefined);
  await new Promise<void>((r) => server.close(() => r()));
});

async function run(path: string) {
  const context = await browser!.newContext();
  const p = await context.newPage();
  await p.goto(`${origin}${path}`, { waitUntil: 'load' });
  const result = await submitOnPage(p, {
    body: 'We are Calldesk and we had one question about how your front desk handles after-hours calls.',
    subject: 'One question',
    email: 'hello@calldesk.tech',
    expectedFieldNames: ['your-name', 'your-email', 'your-message'],
    screenshotDir: join(shotDir, path.replace(/\//g, '_')),
    // Screenshots are exercised, but written to a temp dir rather than ~/.calldesk-forms.
    screenshot: async () => undefined,
  });
  await context.close();
  return result;
}

describe.runIf(process.env.VITEST_SKIP_BROWSER !== '1')('submitOnPage (real Chromium)', () => {
  it.runIf(true)('is skipped with a clear reason when Chromium is not installed', () => {
    if (!browser) {
      console.warn(`[skipped] Chromium unavailable, run "npx playwright install chromium": ${launchError.slice(0, 120)}`);
    }
    expect(true).toBe(true);
  });

  it('confirms a submission that navigates to a thank-you page', async () => {
    if (!browser) return;
    const r = await run('/nav');
    expect(r.outcome).toEqual({ status: 'submitted' });
  });

  it('confirms a submission where the form is replaced by confirmation text', async () => {
    if (!browser) return;
    expect((await run('/xhr')).outcome).toEqual({ status: 'submitted' });
  });

  it('confirms on an explicit success element', async () => {
    if (!browser) return;
    expect((await run('/consent')).outcome).toEqual({ status: 'submitted' });
  });

  it('refuses to claim success on a silent page', async () => {
    if (!browser) return;
    expect((await run('/silent')).outcome).toEqual({ status: 'needs_manual', reason: 'unconfirmed' });
  });

  it('stops on a captcha without filling or submitting anything', async () => {
    if (!browser) return;
    const r = await run('/captcha');
    expect(r.outcome).toEqual({ status: 'needs_manual', reason: 'captcha' });
  });

  it('refuses a required phone number and a required marketing opt-in', async () => {
    if (!browser) return;
    expect((await run('/phone')).outcome).toEqual({ status: 'needs_manual', reason: 'phone required' });
    expect((await run('/marketing')).outcome).toEqual({ status: 'needs_manual', reason: 'required marketing opt-in' });
  });

  it('writes a real before/after full-page screenshot for every attempt', async () => {
    if (!browser) return;
    const dir = join(shotDir, 'shots');
    const context = await browser.newContext();
    const p = await context.newPage();
    await p.goto(`${origin}/xhr`, { waitUntil: 'load' });
    const r = await submitOnPage(p, {
      body: 'A short real message about after-hours calls at the front desk.',
      subject: 'One question',
      email: 'hello@calldesk.tech',
      expectedFieldNames: ['your-name', 'your-email', 'your-message'],
      screenshotDir: dir,
    });
    await context.close();
    expect(r.screenshots).toEqual([join(dir, 'before.png'), join(dir, 'after.png')]);
    for (const path of r.screenshots) expect(statSync(path).size).toBeGreaterThan(0);
  });

  it('hands over a page whose form it cannot find', async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const p = await context.newPage();
    await p.goto(`${origin}/silent`);
    const r = await submitOnPage(p, {
      body: 'x', subject: 's', email: 'hello@calldesk.tech',
      expectedFieldNames: ['nothing-matches'],
      screenshotDir: shotDir, screenshot: async () => undefined,
    });
    // Field names do not match, but a lone form with a textarea is still the contact form.
    expect(r.outcome.status).toBe('needs_manual');
    await context.close();
  });
});

describe('pickForm (no browser needed)', () => {
  const form = (over: Partial<ReadForm>): ReadForm =>
    ({ marker: 'cdf0', fields: [], checkboxes: [], hasTextarea: true, hasSubmit: true, ...over });
  const frames = (forms: ReadForm[]): FrameForms[] => [{ frame: {} as never, forms, html: '', text: '' }];

  it('prefers the form whose field names match the statically detected one', () => {
    const newsletter = form({ marker: 'a', fields: [{ name: 'EMAIL', type: 'email', required: true }], hasTextarea: false });
    const contact = form({
      marker: 'b',
      fields: [
        { name: 'your-name', type: 'text', required: true },
        { name: 'your-email', type: 'email', required: true },
        { name: 'your-message', type: 'textarea', required: true },
      ],
    });
    const picked = pickForm(frames([newsletter, contact]), ['your-name', 'your-email', 'your-message']);
    expect(picked!.form.marker).toBe('b');
  });

  it('ignores forms with no free-text field', () => {
    expect(pickForm(frames([form({ hasTextarea: false })]), ['x'])).toBeNull();
    expect(pickForm([], ['x'])).toBeNull();
  });
});

describe('sameOriginFrames', () => {
  it('keeps the main frame and same-origin children, drops cross-origin embeds', () => {
    const main = { url: () => 'https://practice.com/contact' };
    const same = { url: () => 'https://practice.com/form.html' };
    const other = { url: () => 'https://form.jotform.com/123' };
    const fake = {
      url: () => 'https://practice.com/contact',
      mainFrame: () => main,
      frames: () => [main, same, other],
    } as never;
    expect(sameOriginFrames(fake)).toEqual([main, same]);
  });
});
