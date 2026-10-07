import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_FIXED_GREETING, FIXED_GREETING_EXPLAINER, FIXED_GREETING_TITLE, hasFixedGreeting, withFixedGreeting } from '@/lib/fixedGreeting';
import { FixedGreetingField } from '@/components/builder/FixedGreetingField';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('fixed greeting params', () => {
  it('turns on with the text, trimmed, and keeps other params', () => {
    expect(withFixedGreeting({ foo: 'bar' }, true, '  Hi there.  ')).toEqual({ foo: 'bar', spokenMessage: 'Hi there.' });
    expect(withFixedGreeting(undefined, true)).toEqual({ spokenMessage: DEFAULT_FIXED_GREETING });
  });
  it('turns off by removing the key (the engine then writes the greeting with the AI), keeping other params', () => {
    expect(withFixedGreeting({ foo: 'bar', spokenMessage: 'Hi' }, false)).toEqual({ foo: 'bar' });
    expect(withFixedGreeting({ spokenMessage: 'Hi' }, false)).toBeUndefined();
  });
  it('blank text counts as off', () => {
    expect(withFixedGreeting(undefined, true, '   ')).toBeUndefined();
    expect(hasFixedGreeting({ spokenMessage: '  ' })).toBe(false);
    expect(hasFixedGreeting({ spokenMessage: 'Hello' })).toBe(true);
    expect(hasFixedGreeting(undefined)).toBe(false);
  });
  it('the default only uses the placeholder that Business details always provides', () => {
    expect([...DEFAULT_FIXED_GREETING.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1])).toEqual(['business_name']);
  });
  it('public copy states no timings, prices or comparisons', () => {
    expect(`${FIXED_GREETING_TITLE} ${FIXED_GREETING_EXPLAINER}`).not.toMatch(/[0-9$%¢]|\b(ms|seconds?|faster|cheaper|save)\b/i);
  });
});

describe('FixedGreetingField', () => {
  const render = (on: boolean, text = 'Hi.') => renderToStaticMarkup(createElement(FixedGreetingField, { on, text, onChange: () => {} }));
  it('on: checked, explains itself, shows the text box with the words', () => {
    const html = render(true, 'Welcome to Acme.');
    expect(html).toMatch(/data-testid="fixed-greeting-toggle"[^>]*checked|checked[^>]*data-testid="fixed-greeting-toggle"/);
    expect(strip(html)).toContain(FIXED_GREETING_EXPLAINER);
    expect(strip(html)).toContain('On by default');
    expect(html).toContain('Welcome to Acme.');
  });
  it('off: unchecked, still explains itself, no text box', () => {
    const html = render(false);
    expect(html).not.toMatch(/checked/);
    expect(strip(html)).toContain(FIXED_GREETING_EXPLAINER);
    expect(html).not.toContain('<textarea');
  });
});
