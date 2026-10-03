import { describe, it, expect } from 'vitest';
import { compactMinute, meterEventIdentifier } from '@/lib/reportUsageToStripe';

// Stripe rejects a meter event identifier longer than 100 characters; production runs on Oct 1-3 2026 failed with exactly that for the
// voice dimension because the old format was 105 characters. Every dimension the job can send must stay under the limit, for a real UUID tenant id.
describe('meterEventIdentifier', () => {
  const tenant = 'bd6ee88b-bc62-4f65-a54c-3391322502c8';
  const dimensions = ['voice', 'booking', 'transfer', 'message', 'voice_lite', 'voice_standard', 'voice_pro'];
  const since = new Date('2026-10-03T04:34:00.000Z');
  const until = new Date('2026-10-03T04:36:00.000Z');

  it('stays within 100 characters for every dimension, including a never-reported tenant', () => {
    for (const d of dimensions) {
      for (const s of [since, null]) {
        const id = meterEventIdentifier(tenant, d, `${compactMinute(s)}_${compactMinute(until)}`);
        expect(id.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('is identical on a same-minute retry and different for a different window or dimension', () => {
    const key = `${compactMinute(since)}_${compactMinute(until)}`;
    const a = meterEventIdentifier(tenant, 'voice', key);
    expect(meterEventIdentifier(tenant, 'voice', `${compactMinute(new Date('2026-10-03T04:34:00.000Z'))}_${compactMinute(new Date('2026-10-03T04:36:00.000Z'))}`)).toBe(a);
    expect(meterEventIdentifier(tenant, 'voice', `${compactMinute(since)}_${compactMinute(new Date('2026-10-03T04:37:00.000Z'))}`)).not.toBe(a);
    expect(meterEventIdentifier(tenant, 'voice_standard', key)).not.toBe(a);
  });

  it('formats minutes compactly', () => {
    expect(compactMinute(since)).toBe('20261003T0434');
    expect(compactMinute(null)).toBe('epoch');
  });
});
