import { carryOverFromVersion, type CarryOverSource } from '@/lib/versionCarryOver';
import type { TtsBackend } from '@/types';

// Builds the POST /api/agents/[id]/versions body for the Settings wizard. Versions are immutable, so saving the wizard publishes version
// N+1; everything the user did not change in this session (tier, models, voice) must come along from version N or the new version silently
// changes behaviour and price. Only the engine and TTS backend are choices on this form.

export type SettingsPublishInput = {
  /** The version the new one is built on (the agent's latest), or null/undefined for a first version. */
  previous?: CarryOverSource | null;
  /** The wizard's current engine / backend selection. */
  voiceEngine: string;
  ttsBackend: TtsBackend;
  /** True when the user clicked an engine / backend option in this session. An untouched selection never overrides the previous version. */
  engineTouched?: boolean;
  backendTouched?: boolean;
  flowName: string;
  startNodeId: string;
  nodes: unknown;
  wizardConfig: unknown;
};

export function buildSettingsVersionPayload(i: SettingsPublishInput): Record<string, unknown> {
  const common = { flowName: i.flowName, startNodeId: i.startNodeId, nodes: i.nodes, wizardConfig: i.wizardConfig };
  const prev = i.previous;
  if (!prev) {
    return { ...common, voiceEngine: i.voiceEngine, ttsBackend: i.voiceEngine === 'poc' ? i.ttsBackend : undefined };
  }

  const prevEngine = prev.voice_engine || undefined;
  const prevBackend = (prev.tts_backend as TtsBackend | null) || undefined;
  const engineChanged = !!i.engineTouched && i.voiceEngine !== prevEngine;
  const effEngine = engineChanged ? i.voiceEngine : (prevEngine ?? i.voiceEngine);
  // After an engine change the previous backend means nothing, so the form's selection is used. Otherwise an untouched backend is carried.
  const backendChanged = (!!i.backendTouched && i.ttsBackend !== prevBackend) || (engineChanged && effEngine === 'poc');
  const effBackend: TtsBackend | undefined = backendChanged ? i.ttsBackend : prevBackend;

  // Validate against the engine/backend the new version will really have; whatever no longer fits is dropped, never sent.
  const { body } = carryOverFromVersion({ ...prev, voice_engine: effEngine, tts_backend: effBackend ?? null });
  const changed = engineChanged || backendChanged;
  return {
    ...common,
    voiceEngine: effEngine,
    ttsBackend: effEngine === 'poc' ? body.ttsBackend : undefined,
    // A voice id belongs to one engine/backend pair.
    voiceId: changed ? undefined : body.voiceId,
    llmModel: body.llmModel,
    ttsModel: body.ttsModel,
    tier: body.tier,
    // The server replaces its derived overrides with these, so after a change let it re-derive them against the tier's stack instead.
    tierOverrides: changed ? undefined : body.tierOverrides,
  };
}
