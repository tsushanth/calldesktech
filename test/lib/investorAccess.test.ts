import { describe, it, expect } from 'vitest';
import { canServeInvestorDeck } from '@/lib/deck/investorAccess';

const base = { nodeEnv: 'production', previewToken: 'preview-secret-123', todoCount: 3 };
describe('canServeInvestorDeck', () => {
  it('needs a well-formed code', () => {
    for (const t of [undefined, '', 'ab', 'has space', 'x'.repeat(65), 'a/b']) expect(canServeInvestorDeck({ ...base, t, todoCount: 0 })).toBe(false);
    expect(canServeInvestorDeck({ ...base, t: 'inv-001', todoCount: 0 })).toBe(true);
  });
  it('in production hides the deck from investor codes while placeholders remain', () => {
    expect(canServeInvestorDeck({ ...base, t: 'inv-001' })).toBe(false);
  });
  it('lets the private preview code through even with placeholders', () => {
    expect(canServeInvestorDeck({ ...base, t: 'preview-secret-123' })).toBe(true);
  });
  it('ignores a missing or too-short preview token', () => {
    expect(canServeInvestorDeck({ ...base, previewToken: undefined, t: 'preview' })).toBe(false);
    expect(canServeInvestorDeck({ ...base, previewToken: 'short', t: 'short' })).toBe(false);
  });
  it('renders anything with a code outside production', () => {
    expect(canServeInvestorDeck({ ...base, nodeEnv: 'development', t: 'anything' })).toBe(true);
  });
});
