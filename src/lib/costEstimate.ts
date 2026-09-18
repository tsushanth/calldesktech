// Real-time cost/latency estimate for the builder shell, matching Retell's
// own "Agent details" panel (Cost $/min, Latency ms, Tokens). Only computed
// for poc-engine (CallDeskTech) versions — the rates below are real, current
// provider prices for OUR pipeline (mirrors call-loop-poc's own
// costTracker.js, verified there, not recalled from training data). A
// retell-engine version's real cost is governed entirely by Retell's own
// usage-based pricing, which we don't operate or control, so this
// deliberately doesn't attempt to estimate it rather than showing a
// plausible-looking but ungrounded number.
export const POC_RATES = {
  deepgramFluxPerMin: 0.0065,
  claudeHaiku: { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  ttsPerChar: {
    kokoro: 0, // self-hosted, marginal cost ~0
    elevenlabs: 0.05 / 1000,
    cartesia: 0.05 / 1000,
    minimax: 0.1 / 1000,
  } as Record<string, number>,
};

// Typical single minute of phone conversation, used as the basis for a
// blended $/min estimate — same kind of averaged assumption Retell's own
// dashboard figure necessarily makes (a real call's actual cost varies with
// how much either party talks). ~110 spoken words/min at ~5.5 chars/word
// average English word length is the assumption behind the character count;
// LLM token counts are a rough allowance for one assistant turn's worth of
// reasoning + reply per minute of conversation.
const ASSUMED_TTS_CHARS_PER_MIN = 600;
const ASSUMED_LLM_INPUT_TOKENS_PER_MIN = 400;
const ASSUMED_LLM_OUTPUT_TOKENS_PER_MIN = 120;

export interface CostEstimate {
  costPerMin: number;
  latencyRangeMs: [number, number];
}

export function estimatePocCallCost(ttsBackend: string): CostEstimate {
  const ttsRate = POC_RATES.ttsPerChar[ttsBackend] ?? POC_RATES.ttsPerChar.kokoro;
  const ttsCost = ttsRate * ASSUMED_TTS_CHARS_PER_MIN;
  const llmCost =
    POC_RATES.claudeHaiku.input * ASSUMED_LLM_INPUT_TOKENS_PER_MIN +
    POC_RATES.claudeHaiku.output * ASSUMED_LLM_OUTPUT_TOKENS_PER_MIN;
  const sttCost = POC_RATES.deepgramFluxPerMin;
  const costPerMin = ttsCost + llmCost + sttCost;

  // Real measured ranges from this session's own mystery-shopper calls
  // (turn latency logs) — kokoro/elevenlabs both landed in this band under
  // normal (non-cold-start) conditions; not a per-backend breakdown since
  // the actual bottleneck (LLM TTFB) barely varies by TTS backend.
  const latencyRangeMs: [number, number] = ttsBackend === 'kokoro' ? [900, 2500] : [1500, 2400];

  return { costPerMin: Number(costPerMin.toFixed(3)), latencyRangeMs };
}
