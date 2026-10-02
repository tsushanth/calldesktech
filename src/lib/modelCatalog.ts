import type { TtsBackend } from '@/types';

// The models an agent version can choose, for the language model (what decides what the agent says and which fields it records)
// and for the voice (the text-to-speech model within the chosen voice backend). One source of truth for the API, the MCP server
// and the docs. The voice engine (call-loop-poc) holds the same allowlists and the provider keys; if it cannot use a model it
// falls back to the default one, so an agent never fails to answer because of this setting.
//
// Prices are USD from each provider's own pricing page (retrieved 2026-10-02); they describe provider cost, not what customers are
// billed (customers pay per minute by voice backend, see /pricing).

export type LlmModelOption = {
  id: string;
  label: string;
  provider: 'anthropic' | 'openai' | 'gemini';
  /** USD per million input / output tokens. */
  price: { in: number; out: number };
  default?: boolean;
  /** 'tested' = passed our structured benchmark on this flow engine; 'preview' = wired in but not benchmarked yet. */
  status: 'tested' | 'preview';
  notes: string;
};

export type TtsModelOption = {
  id: string;
  backend: Extract<TtsBackend, 'elevenlabs' | 'cartesia'>;
  label: string;
  /** USD per 1,000 characters of speech. */
  pricePer1kChars: number | null;
  default?: boolean;
  notes: string;
};

export const DEFAULT_LLM_MODEL = 'claude-haiku-4-5-20251001';

export const LLM_MODELS: LlmModelOption[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', price: { in: 1, out: 5 }, default: true, status: 'tested', notes: 'The default. Fastest first response of the tested models (about 0.6 s) and the most reliable at recording fields and following the flow.' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', price: { in: 3, out: 15 }, status: 'tested', notes: 'Stronger reasoning for complex flows, about three times the price of Haiku and slower.' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: 'openai', price: { in: 0.1, out: 0.5 }, status: 'tested', notes: 'About a tenth of Haiku’s cost. Passed our cooperative-caller benchmark 6 of 6, but responds slower (roughly 0.5 to 1.6 s) because turns that record a field need a second request. Not yet cleared on the stress tests (corrections, misheard numbers).' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'gemini', price: { in: 0.1, out: 0.4 }, status: 'preview', notes: 'Preview: wired in but not benchmarked on our flows. Used only if the voice engine has a Gemini key configured; otherwise the agent uses the default model.' },
];

export const TTS_MODELS: TtsModelOption[] = [
  { id: 'eleven_multilingual_v2', backend: 'elevenlabs', label: 'ElevenLabs Multilingual v2', pricePer1kChars: 0.08, default: true, notes: 'The current default: natural, supports every language we offer.' },
  { id: 'eleven_flash_v2_5', backend: 'elevenlabs', label: 'ElevenLabs Flash v2.5', pricePer1kChars: 0.04, notes: 'Half the cost of Multilingual v2 and the fastest to first audio.' },
  { id: 'eleven_turbo_v2_5', backend: 'elevenlabs', label: 'ElevenLabs Turbo v2.5', pricePer1kChars: null, notes: 'Previous-generation low-latency model.' },
  { id: 'eleven_v4_turbo', backend: 'elevenlabs', label: 'ElevenLabs v4 Turbo', pricePer1kChars: 0.04, notes: 'The most expressive low-latency model. Introductory price of $0.011 per 1,000 characters until 2026-10-12, then $0.04.' },
  { id: 'sonic-3.6', backend: 'cartesia', label: 'Cartesia Sonic 3.6', pricePer1kChars: null, default: true, notes: 'Cartesia’s default model.' },
  { id: 'sonic-2', backend: 'cartesia', label: 'Cartesia Sonic 2', pricePer1kChars: null, notes: 'Previous generation.' },
];

export function getModelCatalog() {
  return {
    defaults: { llmModel: DEFAULT_LLM_MODEL },
    llmModels: LLM_MODELS,
    ttsModels: TTS_MODELS,
    notes: [
      'llmModel applies to agents on the in-house voice engine (voiceEngine "poc"). If the engine cannot use the chosen model (for example its provider key is not configured) or the provider fails before the agent speaks, the default model answers, so the call still works.',
      'ttsModel must belong to the agent’s voice backend (ttsBackend). The kokoro and minimax backends have no model choice.',
      'Individual flow nodes can override the model with params.model.',
    ],
  };
}

const llmIds = new Set(LLM_MODELS.map((m) => m.id));

export function isValidLlmModel(id: unknown): id is string {
  return typeof id === 'string' && llmIds.has(id);
}

export function ttsModelsFor(backend: string | null | undefined): TtsModelOption[] {
  return TTS_MODELS.filter((m) => m.backend === backend);
}

export function isValidTtsModel(backend: string | null | undefined, id: unknown): id is string {
  return typeof id === 'string' && ttsModelsFor(backend).some((m) => m.id === id);
}

/**
 * Validates the optional model fields of a publish-version request. Returns an error message (for a 400) or null.
 * `ttsBackend` is the backend the version will actually use (after language pinning).
 */
export function validateModelChoice(opts: { voiceEngine: string | undefined; llmModel?: unknown; ttsModel?: unknown; ttsBackend?: string | null }): string | null {
  const { voiceEngine, llmModel, ttsModel, ttsBackend } = opts;
  if (llmModel !== undefined && llmModel !== null) {
    if (voiceEngine !== 'poc') return 'llmModel applies only to agents on the in-house voice engine (voiceEngine "poc")';
    if (!isValidLlmModel(llmModel)) return `Unknown llmModel "${String(llmModel)}". Valid: ${LLM_MODELS.map((m) => m.id).join(', ')}`;
  }
  if (ttsModel !== undefined && ttsModel !== null) {
    if (voiceEngine !== 'poc') return 'ttsModel applies only to agents on the in-house voice engine (voiceEngine "poc")';
    const valid = ttsModelsFor(ttsBackend);
    if (valid.length === 0) return `The "${ttsBackend || 'default'}" voice backend has no model choice; set ttsBackend to "elevenlabs" or "cartesia" to choose a ttsModel`;
    if (!isValidTtsModel(ttsBackend, ttsModel)) return `Unknown ttsModel "${String(ttsModel)}" for backend "${ttsBackend}". Valid: ${valid.map((m) => m.id).join(', ')}`;
  }
  return null;
}
