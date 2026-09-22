import { describe, it, expect } from 'vitest';
import { estimatePocCallCost, POC_RATES } from '@/lib/costEstimate';

describe('estimatePocCallCost', () => {
  it('falls back to the kokoro (free) TTS rate for an unrecognized backend, but the non-kokoro latency band (latency is keyed on the literal backend string)', () => {
    const known = estimatePocCallCost('kokoro');
    const unknown = estimatePocCallCost('some-unrecognized-backend');
    expect(unknown.costPerMin).toBe(known.costPerMin);
    expect(unknown.latencyRangeMs).toEqual([1500, 2400]);
  });

  it('costs more for elevenlabs (paid TTS) than kokoro (free TTS)', () => {
    const kokoro = estimatePocCallCost('kokoro');
    const elevenlabs = estimatePocCallCost('elevenlabs');
    expect(elevenlabs.costPerMin).toBeGreaterThan(kokoro.costPerMin);
    expect(elevenlabs.latencyRangeMs).toEqual([1500, 2400]);
  });

  it('rounds costPerMin to 3 decimal places', () => {
    const { costPerMin } = estimatePocCallCost('minimax');
    expect(costPerMin).toBe(Number(costPerMin.toFixed(3)));
  });

  it('matches a hand-computed cost for kokoro (STT + LLM only, TTS free)', () => {
    const sttCost = POC_RATES.deepgramFluxPerMin; // 0.0065
    const llmCost = POC_RATES.claudeHaiku.input * 400 + POC_RATES.claudeHaiku.output * 120;
    const expected = Number((sttCost + llmCost).toFixed(3));
    expect(estimatePocCallCost('kokoro').costPerMin).toBe(expected);
  });
});
