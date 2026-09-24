import { describe, it, expect } from 'vitest';
import { renderOutreachEmail } from '@/lib/outreach/emailHtml';

const footer = {
  text: '\n\n--\nCalldesk (calldesk.tech)\n1 Main St\nUnsubscribe: https://calldesk.tech/unsubscribe/x',
  html: '<p style="color:#6b7280;font-size:12px;margin-top:24px">Calldesk<br/><a href="https://calldesk.tech/unsubscribe/x">Unsubscribe</a></p>',
};
const bodyText = 'Hi there,\n\nQuick research question about dispatch calls & after-hours <coverage>.\n\nThanks,\nSush';
const line = (i: number) => ({ speaker: (i % 2 ? 'agent' : 'caller') as 'caller' | 'agent', text: `line ${i}` });
const sample = (n = 4) => ({
  title: 'Freight quote', durationLabel: '1:32', lines: Array.from({ length: n }, (_, i) => line(i)),
  url: 'https://calldesk.tech/samples/freight?t=abc.def', disclosure: 'AI test caller talking to a Calldesk demo agent for a fictional business',
});

describe('renderOutreachEmail', () => {
  it('without sample equals the historical sender output exactly (regression pin)', () => {
    const { html, text } = renderOutreachEmail({ bodyText, footer });
    expect(html).toBe(
      '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1d29;max-width:560px">' +
        '<p style="margin:0 0 14px">Hi there,</p>' +
        '<p style="margin:0 0 14px">Quick research question about dispatch calls &amp; after-hours &lt;coverage&gt;.</p>' +
        '<p style="margin:0 0 14px">Thanks,<br/>Sush</p>' + footer.html + '</div>',
    );
    expect(text).toBe(`${bodyText}${footer.text}`);
  });

  it('empty sample lines falls back to the plain output', () => {
    const plain = renderOutreachEmail({ bodyText, footer });
    expect(renderOutreachEmail({ bodyText, footer, sample: { ...sample(), lines: [] } })).toEqual(plain);
  });

  it('escapes transcript text', () => {
    const s = sample(2);
    s.lines[0].text = '<script>alert(1)</script> Tom & Jerry';
    const { html, text } = renderOutreachEmail({ bodyText, footer, sample: s });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Tom &amp; Jerry');
    expect(text).toContain('Caller: <script>alert(1)</script> Tom & Jerry');
  });

  it('includes URL in html and text, plus disclosure', () => {
    const s = sample();
    const { html, text } = renderOutreachEmail({ bodyText, footer, sample: s });
    expect(html).toContain(`href="${s.url}"`);
    expect(html).toContain('Listen to the full sample call');
    expect(html).toContain(s.disclosure);
    expect(text).toContain(s.url);
    expect(text).toContain(s.disclosure);
  });

  it('escapes quotes in the href', () => {
    const { html } = renderOutreachEmail({ bodyText, footer, sample: { ...sample(), url: 'https://x.test/?a="b"&c=1' } });
    expect(html).toContain('href="https://x.test/?a=&quot;b&quot;&amp;c=1"');
  });

  it('caps the card at 6 lines', () => {
    const { html, text } = renderOutreachEmail({ bodyText, footer, sample: sample(10) });
    expect(html).toContain('line 5');
    expect(html).not.toContain('line 6');
    expect(text.match(/^(Caller|Agent): /gm)).toHaveLength(6);
  });

  it('keeps footer and unsubscribe, card sits between body and footer, no images', () => {
    const { html, text } = renderOutreachEmail({ bodyText, footer, sample: sample() });
    expect(html).toContain('Unsubscribe');
    expect(html.indexOf('Sample call')).toBeGreaterThan(html.indexOf('Thanks,'));
    expect(html.indexOf('Sample call')).toBeLessThan(html.indexOf('Unsubscribe'));
    expect(html).not.toMatch(/<img/i);
    expect(text.endsWith(footer.text)).toBe(true);
  });

  it('text alternative structure: body, sample section, footer; speaker labelled in html without color alone', () => {
    const { html, text } = renderOutreachEmail({ bodyText, footer, sample: sample(2) });
    expect(text.startsWith(bodyText + '\n\nSample call · 1:32 · AI demo')).toBe(true);
    expect(text).toContain('Caller: line 0\nAgent: line 1\nListen to the full sample call: ');
    expect(html).toContain('CALLER');
    expect(html).toContain('AGENT');
  });
});
