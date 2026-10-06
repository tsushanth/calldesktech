import { describe, it, expect } from 'vitest';
import { OUTCOMES, WIN_OUTCOMES, generateToken, hashToken, isOutcome, validateOutcomeInput } from '@/lib/callerPortal';

describe('outcomes', () => {
  it('has the eight outcomes from the script, and two kinds of win', () => {
    expect(OUTCOMES).toHaveLength(8);
    expect(WIN_OUTCOMES).toEqual(['forward_number_requested', 'callback_requested']);
    expect(isOutcome('voicemail')).toBe(true);
    expect(isOutcome('maybe')).toBe(false);
    expect(isOutcome(undefined)).toBe(false);
  });
});

describe('validateOutcomeInput', () => {
  it('accepts a plain outcome and trims notes', () => {
    expect(validateOutcomeInput({ outcome: 'voicemail', notes: '  left none  ' })).toEqual({
      ok: true,
      value: { outcome: 'voicemail', notes: 'left none', mobile_number: null, text_ok: false },
    });
    expect(validateOutcomeInput({ outcome: 'no_answer' })).toMatchObject({ ok: true, value: { notes: null } });
  });
  it('rejects an unknown outcome', () => {
    expect(validateOutcomeInput({ outcome: 'hot_lead' }).ok).toBe(false);
    expect(validateOutcomeInput({}).ok).toBe(false);
  });
  it('needs a valid mobile number and the agreed-to-text box for a forward-number win', () => {
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'forward_number_requested' }).ok).toBe(false);
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'forward_number_requested', mobile_number: '555', text_ok: true }).ok).toBe(false);
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'forward_number_requested', mobile_number: '(425) 628-4887', text_ok: false }).ok).toBe(false);
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'forward_number_requested', mobile_number: '(425) 628-4887', text_ok: true })).toEqual({
      ok: true,
      value: { outcome: 'forward_number_requested', notes: '[dm:yes]', mobile_number: '+14256284887', text_ok: true },
    });
  });
  it('needs a callback time in the notes', () => {
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'callback_requested' }).ok).toBe(false);
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'callback_requested', notes: 'Monday 2pm CT' }).ok).toBe(true);
  });
  it('clears any stray mobile number on other outcomes', () => {
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'not_interested', reason: 'bad_timing', mobile_number: '4256284887', text_ok: true })).toMatchObject({
      ok: true,
      value: { mobile_number: null, text_ok: false },
    });
  });
  it('caps notes at 1000 characters', () => {
    const r = validateOutcomeInput({ decision_maker: true, outcome: 'gatekeeper', notes: 'x'.repeat(2000) });
    expect(r.ok && r.value.notes?.length).toBe(1000);
  });
});

describe('private link tokens', () => {
  it('are random, long, and URL safe, and only their hash is comparable', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(30);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken(a)).not.toContain(a);
  });
});
