import { describe, it, expect } from 'vitest';
import { parseSerp, serpQueriesForDay } from '@/lib/outreach/discovery/serpAds';

const resp = (items: unknown[]) => ({ tasks: [{ result: [{ items }] }] });

describe('parseSerp', () => {
  it('keeps paid ads and top organic results, flags ads', () => {
    const out = parseSerp(resp([
      { type: 'paid', domain: 'www.dialzara.com', title: 'Dialzara | AI Receptionist', description: 'Never miss a call.' },
      { type: 'organic', domain: 'smith.ai', title: 'Smith.ai - AI receptionists', description: 'Live and AI.' },
      { type: 'people_also_ask', domain: 'x.com' },
    ]), 'white label ai receptionist');
    expect(out.map((c) => c.domain)).toEqual(['dialzara.com', 'smith.ai']);
    expect(out[0].ad).toBe(true);
    expect(out[0].name).toBe('Dialzara');
    expect(out[1].ad).toBe(false);
    expect(out[0].blurb).toMatch(/^Paid Google ad/);
  });
  it('drops platforms, directories and social sites', () => {
    const out = parseSerp(resp([
      { type: 'paid', domain: 'retellai.com', title: 'Retell' },
      { type: 'organic', domain: 'g2.com', title: 'Best AI receptionists' },
      { type: 'organic', domain: 'reddit.com', title: 'thread' },
    ]), 'q');
    expect(out).toEqual([]);
  });
  it('counts a domain once and keeps the ad flag', () => {
    const out = parseSerp(resp([
      { type: 'organic', domain: 'goodcall.com', title: 'Goodcall' },
      { type: 'paid', domain: 'goodcall.com', title: 'Goodcall ad' },
    ]), 'q');
    expect(out).toHaveLength(1);
    expect(out[0].ad).toBe(true);
  });
  it('only looks at the top organic results', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ type: 'organic', domain: `site${i}.com`, title: `Site ${i}` }));
    expect(parseSerp(resp(items), 'q')).toHaveLength(10);
  });
  it('tolerates an empty or failed response', () => {
    expect(parseSerp(null, 'q')).toEqual([]);
    expect(parseSerp({ tasks: null }, 'q')).toEqual([]);
  });
});

describe('serpQueriesForDay', () => {
  it('rotates through the query bank', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 40; s++) for (const q of serpQueriesForDay(new Date(s * 2 * 60 * 60_000), 2)) seen.add(q);
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});
