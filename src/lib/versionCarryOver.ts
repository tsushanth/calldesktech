import { validateModelChoice } from '@/lib/modelCatalog';
import { tierById } from '@/lib/pricingTiers';
import type { TtsBackend } from '@/types';

// Versions are immutable, so "restore as new version" and "accept a Copilot suggestion" publish a NEW version built from an old one. The
// voice, model and pricing-tier fields must come along or the new version silently changes behaviour (and, without the tier, price).
// Old rows can hold values that would now be refused by POST /api/agents/[id]/versions (a model since removed from the catalog, for
// example); those are dropped here, and named in `dropped`, instead of failing the whole restore.

/** The model/pricing columns of a calldesk_agent_versions row. */
export type CarryOverSource = {
  voice_engine: string | null;
  voice_id?: string | null;
  tts_backend?: TtsBackend | string | null;
  llm_model?: string | null;
  tts_model?: string | null;
  tier?: string | null;
  tier_overrides?: string[] | null;
};

export const TIER_OVERRIDE_FIELDS = ['llmModel', 'ttsBackend', 'ttsModel'] as const;

/** Request-body fields for POST /api/agents/[id]/versions (undefined = not set). */
export type CarryOverBody = {
  voiceId?: string;
  ttsBackend?: TtsBackend;
  llmModel?: string;
  ttsModel?: string;
  tier?: 'lite' | 'standard' | 'pro';
  tierOverrides?: string[];
  /** Set for a lowerQuality tier (Lite): the original publisher already accepted that tradeoff, so the rebuilt version carries it. */
  acceptLowerQuality?: true;
};

export function carryOverFromVersion(v: CarryOverSource): { body: CarryOverBody; dropped: string[] } {
  const dropped: string[] = [];
  const engine = v.voice_engine || undefined;
  const ttsBackend = (v.tts_backend as TtsBackend | null) || undefined;

  let tier: CarryOverBody['tier'];
  if (v.tier) {
    const t = tierById(v.tier);
    if (t && t.availability === 'live' && engine === 'poc') tier = t.id;
    else dropped.push('tier');
  }

  let llmModel = v.llm_model || undefined;
  if (llmModel && validateModelChoice({ voiceEngine: engine, llmModel })) { dropped.push('llmModel'); llmModel = undefined; }

  let ttsModel = v.tts_model || undefined;
  if (ttsModel && validateModelChoice({ voiceEngine: engine, ttsModel, ttsBackend })) { dropped.push('ttsModel'); ttsModel = undefined; }

  // Which fields the original publisher chose explicitly rather than taking the tier's. Only meaningful with a tier, and only for fields
  // that survived validation (a dropped field falls back to the tier's own choice).
  let tierOverrides: string[] | undefined;
  if (tier && Array.isArray(v.tier_overrides)) {
    const kept = v.tier_overrides.filter((f) =>
      (f === 'llmModel' && llmModel) || (f === 'ttsModel' && ttsModel) || (f === 'ttsBackend' && ttsBackend));
    if (kept.length) tierOverrides = kept;
  }

  return {
    body: { voiceId: v.voice_id || undefined, ttsBackend, llmModel, ttsModel, tier, tierOverrides, acceptLowerQuality: tier && tierById(tier)?.lowerQuality ? true : undefined },
    dropped,
  };
}
