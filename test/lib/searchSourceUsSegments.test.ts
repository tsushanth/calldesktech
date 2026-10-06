import { describe, it, expect } from 'vitest';
import { queriesForDay } from '@/lib/outreach/discovery/searchSource';

const SLOT = 2 * 60 * 60_000;

describe('queriesForDay US segments', () => {
  it('reaches GoHighLevel and answering-service queries within a cycle', () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < 120; slot++) for (const q of queriesForDay(new Date(slot * SLOT), 3)) seen.add(q);
    expect([...seen].some((q) => /GoHighLevel/i.test(q))).toBe(true);
    expect([...seen].some((q) => /answering service/i.test(q))).toBe(true);
    expect([...seen].some((q) => /VoIP reseller|business phone system reseller/i.test(q))).toBe(true);
  });
  it('keeps the original vertical and region queries in rotation', () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < 120; slot++) for (const q of queriesForDay(new Date(slot * SLOT), 3)) seen.add(q);
    expect([...seen].some((q) => q.startsWith('AI voice agent agency in '))).toBe(true);
    expect([...seen].some((q) => q.startsWith('AI receptionist company for '))).toBe(true);
  });
});
