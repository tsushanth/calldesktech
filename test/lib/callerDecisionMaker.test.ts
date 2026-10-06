import { describe, expect, it } from 'vitest';
import { OUTCOMES_ASKING_DECISION_MAKER, decisionMakerOf, declineReasonOf, stripReason, validateOutcomeInput, withTags } from '@/lib/callerPortal';

describe('decision maker yes/no', () => {
  it('is required on every outcome where a person spoke', () => {
    for (const outcome of OUTCOMES_ASKING_DECISION_MAKER) {
      const base = { outcome, notes: 'x', reason: 'bad_timing', mobile_number: '4256284887', text_ok: true };
      expect(validateOutcomeInput(base)).toMatchObject({ ok: false });
      expect(validateOutcomeInput({ ...base, decision_maker: 'yes' })).toMatchObject({ ok: false });
      expect(validateOutcomeInput({ ...base, decision_maker: true })).toMatchObject({ ok: true });
      expect(validateOutcomeInput({ ...base, decision_maker: false })).toMatchObject({ ok: true });
    }
  });
  it('is not asked when nobody spoke (no answer, voicemail, wrong number)', () => {
    for (const outcome of ['no_answer', 'voicemail', 'wrong_number']) {
      const r = validateOutcomeInput({ outcome, notes: 'n' });
      expect(r).toMatchObject({ ok: true, value: { notes: 'n' } });
    }
  });
  it('is stored as a tag and read back, together with the decline reason', () => {
    const r = validateOutcomeInput({ outcome: 'not_interested', reason: 'covered_24_7', decision_maker: true, notes: 'owner, staffed' });
    expect(r).toMatchObject({ ok: true, value: { notes: '[dm:yes][reason:covered_24_7] owner, staffed' } });
    if (r.ok) {
      expect(decisionMakerOf(r.value.notes)).toBe(true);
      expect(declineReasonOf(r.value.notes)).toBe('covered_24_7');
      expect(stripReason(r.value.notes)).toBe('owner, staffed');
    }
    const g = validateOutcomeInput({ outcome: 'gatekeeper', decision_maker: false, notes: 'back at 3, email x@y.com' });
    expect(g).toMatchObject({ ok: true, value: { notes: '[dm:no] back at 3, email x@y.com' } });
  });
  it('re-saving a row does not stack or lose tags', () => {
    const first = withTags({ dm: false, reason: 'has_staff' }, 'hi');
    const again = validateOutcomeInput({ outcome: 'not_interested', reason: 'price', decision_maker: true, notes: first });
    expect(again).toMatchObject({ ok: true, value: { notes: '[dm:yes][reason:price] hi' } });
  });
  it('old rows without the tag read as unknown, not as No', () => {
    expect(decisionMakerOf('[reason:other] x')).toBeNull();
    expect(decisionMakerOf(null)).toBeNull();
    expect(decisionMakerOf('talked to [dm:yes] later')).toBeNull();
  });
  it('a callback still needs a written time even with the tag', () => {
    expect(validateOutcomeInput({ outcome: 'callback_requested', decision_maker: true, notes: '' })).toMatchObject({ ok: false });
    expect(validateOutcomeInput({ outcome: 'callback_requested', decision_maker: true, notes: 'Thu 2pm' })).toMatchObject({ ok: true });
  });
});
