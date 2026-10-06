import { describe, expect, it } from 'vitest';
import { declineReasonOf, stripReason, validateOutcomeInput } from '@/lib/callerPortal';

describe('decline reason on "Not interested"', () => {
  it('is required', () => {
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'not_interested' })).toMatchObject({ ok: false });
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'not_interested', reason: 'nope' })).toMatchObject({ ok: false });
  });
  it('is stored at the start of the notes and read back', () => {
    const r = validateOutcomeInput({ decision_maker: true, outcome: 'not_interested', reason: 'covered_24_7', notes: 'dispatch is staffed' });
    expect(r).toMatchObject({ ok: true, value: { notes: '[dm:yes][reason:covered_24_7] dispatch is staffed' } });
    if (r.ok) { expect(declineReasonOf(r.value.notes)).toBe('covered_24_7'); expect(stripReason(r.value.notes)).toBe('dispatch is staffed'); }
  });
  it('"other" needs a written note', () => {
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'not_interested', reason: 'other' })).toMatchObject({ ok: false });
    expect(validateOutcomeInput({ decision_maker: true, outcome: 'not_interested', reason: 'other', notes: 'hauls bees' })).toMatchObject({ ok: true });
  });
  it('does not touch other outcomes and re-saving does not duplicate the tag', () => {
    expect(validateOutcomeInput({ outcome: 'voicemail', notes: 'x' })).toMatchObject({ ok: true, value: { notes: 'x' } });
    const again = validateOutcomeInput({ decision_maker: true, outcome: 'not_interested', reason: 'has_staff', notes: '[reason:covered_24_7] hi' });
    expect(again).toMatchObject({ ok: true, value: { notes: '[dm:yes][reason:has_staff] hi' } });
  });
});
