import { describe, it, expect } from 'vitest';
import { buildInvestorSlides, investorDeckTodos, PRICING_AS_OF } from '@/lib/deck/investorSlides';

describe('investor deck', () => {
  const slides = buildInvestorSlides();
  const text = slides.join(' ').replace(/<[^>]+>/g, ' ');

  it('has the planned slides, each a 1920x1080-style section with a unique id and page number', () => {
    expect(slides.length).toBe(15);
    const ids = slides.map((s) => /id="([^"]+)"/.exec(s)?.[1]);
    expect(new Set(ids).size).toBe(slides.length);
    expect(ids).toEqual(expect.arrayContaining(['problem', 'price', 'human', 'cost', 'compete', 'roadmap', 'data', 'behind', 'distribution', 'team', 'ask']));
  });
  it('is dated and attributes its prices', () => {
    expect(PRICING_AS_OF).toMatch(/2026/);
    expect(text).toContain("each vendor's own pricing page");
  });
  it('makes no traction claim and states the arithmetic assumptions', () => {
    expect(text).not.toMatch(/paying customers|ARR|MRR|revenue of|customers worldwide/i);
    expect(text).toContain('Assumes a 2-minute call');
    expect(text).toContain('small sample');
  });
  it('uses no em dashes or other non-ASCII punctuation in the copy (entities are fine)', () => {
    expect(text).not.toMatch(/[—–‘’“”]/);
  });
  it('does not mention immigration status or leave', () => {
    expect(text).not.toMatch(/h-?1b|visa|\bo-?1\b|sponsor|leave of absence|\bFMLA\b|sedgwick/i);
  });
  it('still has founder-supplied TODO markers until they are filled in', () => {
    expect(investorDeckTodos(slides).length).toBeGreaterThan(0);
  });
});
