import { describe, it, expect } from 'vitest';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderScript } from '@/lib/scriptMarkdown';

const html = (md: string) => renderToStaticMarkup(createElement(Fragment, null, ...renderScript(md)));

describe('renderScript', () => {
  it('renders headings, bullets, quotes and bold', () => {
    const out = html('# Title\n\n## Section\n\n- one **bold** item\n- two\n\n> "Say this."\n\nPlain text.');
    expect(out).toContain('<h1');
    expect(out).toContain('<h2');
    expect(out).toContain('<li>one <strong>bold</strong> item</li>');
    expect(out).toContain('<blockquote');
    expect(out).toContain('Say this.');
  });
  it('never injects raw HTML from the file', () => {
    const out = html('Hello <script>alert(1)</script> world');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
  it('renders a table', () => {
    expect(html('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<td');
  });
});

describe('call scripts', () => {
  const dir = join(__dirname, '..', '..', 'outreach', 'scripts');
  it.each(['cold-call-script-reseller.md', 'cold-call-script-freight.md'])('%s tells the caller what to do when an AI answers', (f) => {
    const t = readFileSync(join(dir, f), 'utf8');
    expect(t).toMatch(/When an AI answers/);
    expect(t).toMatch(/AI, left message/);
    expect(t).toMatch(/calldesk dot tech/);
  });
  it('the reseller message leads with the price and keeps to the approved prices', () => {
    const t = readFileSync(join(dir, 'cold-call-script-reseller.md'), 'utf8');
    const msg = t.slice(t.indexOf('**Leave this short message**'), t.indexOf('## Voicemail with a person'));
    expect(msg).toMatch(/2 cents a minute/);
    expect(msg).toMatch(/four tenths of a cent/);
    expect(msg).toMatch(/eleven cents an hour/);
    expect(msg).not.toMatch(/cheaper|cheapest|better than/i);
  });
});
