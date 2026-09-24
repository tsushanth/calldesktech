import { describe, it, expect } from 'vitest';
import { detectContactForm } from '@/lib/outreach/discovery/contactPages';
describe('detectContactForm', () => {
  const html = `<form action="/send" method="post"><input type="hidden" name="t"><input name="your-name" required><input type="email" name="your-email" required><textarea name="msg"></textarea><div class="g-recaptcha"></div></form><form role="search"><input name="s"></form>`;
  it('finds contact form with captcha', () => {
    const f = detectContactForm(html, 'https://x.com/contact')!;
    expect(f.fields.map((x) => x.name)).toEqual(['your-name', 'your-email', 'msg']);
    expect(f.captcha).toBe(true); expect(f.action).toBe('https://x.com/send');
  });
  it('ignores search-only pages and finds embeds', () => {
    expect(detectContactForm('<form role="search"><input name="s"></form>', 'https://x.com/')).toBeNull();
    expect(detectContactForm('<iframe src="https://form.jotform.com/123"></iframe>', 'https://x.com/c')?.method).toBe('embedded');
  });
});
