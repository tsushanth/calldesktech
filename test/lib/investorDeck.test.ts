import { describe, it, expect } from 'vitest';
import { buildInvestorSlides, investorDeckTodos, PRICING_AS_OF } from '@/lib/deck/investorSlides';

describe('investor deck', () => {
  const slides = buildInvestorSlides();
  const text = slides.join(' ').replace(/<[^>]+>/g, ' ');

  it('has the planned slides, each a 1920x1080-style section with a unique id and page number', () => {
    expect(slides.length).toBe(14);
    const ids = slides.map((s) => /id="([^"]+)"/.exec(s)?.[1]);
    expect(new Set(ids).size).toBe(slides.length);
    expect(ids).toEqual(expect.arrayContaining(['problem', 'price', 'human', 'compete', 'roadmap', 'data', 'behind', 'distribution', 'team', 'ask']));
  });
  it('is dated and attributes its prices', () => {
    expect(PRICING_AS_OF).toMatch(/2026/);
    expect(text).toContain("each vendor's own pricing page");
  });
  it('makes no traction claim and states the arithmetic assumptions', () => {
    expect(text).not.toMatch(/paying customers|ARR|MRR|revenue of|customers worldwide/i);
    expect(text).toContain('Assumes a 2-minute call');
  });
  it('uses no em dashes or other non-ASCII punctuation in the copy (entities are fine)', () => {
    expect(text).not.toMatch(/[—–‘’“”]/);
  });
  it('does not mention immigration status or leave', () => {
    expect(text).not.toMatch(/h-?1b|visa|\bo-?1\b|sponsor|leave of absence|\bFMLA\b|sedgwick/i);
  });
  it('has no TODO placeholders left, so it can be served publicly', () => {
    expect(investorDeckTodos(slides)).toEqual([]);
  });
  it('states the ask: $500K on a SAFE, the three uses, and the milestone', () => {
    expect(text).toContain('$500K on a SAFE');
    expect(text).toContain('Run pilots in three trades');
    expect(text).toContain('compliance work dental and home care need');
    expect(text).toContain('Self-host our voice');
    expect(text).toContain('pilots converting to paid in three trades');
  });
});
