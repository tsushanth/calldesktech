import { describe, it, expect } from 'vitest';
import { estimatePocLatencyRange } from '@/lib/latencyEstimate';

describe('estimatePocLatencyRange', () => {
  it('uses the kokoro band for kokoro', () => {
    expect(estimatePocLatencyRange('kokoro')).toEqual([900, 2500]);
  });

  it('uses the non-kokoro band for any other backend, including unrecognized ones (keyed on the literal backend string)', () => {
    expect(estimatePocLatencyRange('elevenlabs')).toEqual([1500, 2400]);
    expect(estimatePocLatencyRange('some-unrecognized-backend')).toEqual([1500, 2400]);
  });
});
