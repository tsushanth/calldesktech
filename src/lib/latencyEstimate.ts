// Typical response-latency band shown in the builder shell's "Agent details" panel for poc-engine
// (CallDeskTech) versions. Observed ranges from our own test calls under normal (non-cold-start)
// conditions; the bottleneck (LLM time to first byte) barely varies by voice backend.
export function estimatePocLatencyRange(ttsBackend: string): [number, number] {
  return ttsBackend === 'kokoro' ? [900, 2500] : [1500, 2400];
}
