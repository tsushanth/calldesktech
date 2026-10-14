import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRICING } from '@/lib/constants';
import { LITE_LLM_MODEL, STANDARD_LLM_MODEL, PRO_LLM_MODEL, validateModelChoice } from '@/lib/modelCatalog';
import {
  ADD_ONS, INCLUDED_ON_ALL, LITE_LANGUAGE_VOICES, PIPER_LANGUAGE_VOICES, PRICING_TIERS, TIER_IDS, priceFor, ratingsForStack, publicPricing, resolveTierForPublish, stackErrors, stackForTier, tierById, tierForLegacyConfig,
  piperVoiceLanguage, tierVoiceLanguages, tierVoiceSupportsLanguage, piperLanguageSentence,
} from '@/lib/pricingTiers';
import { AGENT_LANGUAGES, PIPER_LANGUAGES } from '@/lib/languages';

describe('pricing tiers', () => {
  it('has exactly Lite, Standard and Pro at 2, 5 and 9 cents per minute', () => {
    expect(PRICING_TIERS.map((t) => [t.id, t.pricePerMinuteCents])).toEqual([['lite', 2], ['standard', 5], ['pro', 9]]);
    expect([...TIER_IDS]).toEqual(['lite', 'standard', 'pro']);
  });
  it('every tier is bring-your-own carrier', () => {
    for (const t of PRICING_TIERS) expect(t.carrierMode).toBe('byo');
  });
  it('all three tiers are on sale', () => {
    expect(PRICING_TIERS.filter((t) => t.availability === 'coming_soon')).toEqual([]);
  });
  it('the platform features are stated once for every plan, not per tier', () => {
    const all = INCLUDED_ON_ALL.join(' | ');
    for (const re of [/summary/i, /transcript/i, /extraction/i, /transfers/i, /DTMF/, /knowledge base/i, /calendar booking/i, /testing and live call monitoring/i, /API and MCP/i, /40\+ languages/i]) expect(all).toMatch(re);
    expect(all).toMatch(/Lite speaks English, German, Spanish, French, Italian and Portuguese/);
    expect(all).not.toMatch(/English only/);
    expect(all).not.toMatch(/steer|proposed fix/i);
    for (const t of PRICING_TIERS) expect(t).not.toHaveProperty('includes');
  });
  it('each tier has Voice / Response speed / Reasoning labels derived from its stack, with no numbers', () => {
    expect(PRICING_TIERS.map((t) => ratingsForStack(t.stack))).toEqual([
      { voice: 'Clear and efficient', responseSpeed: 'Good', reasoning: 'Good' },
      { voice: 'Natural', responseSpeed: 'Fast', reasoning: 'Strong' },
      { voice: 'Most expressive', responseSpeed: 'Fast', reasoning: 'Strongest' },
    ]);
    expect(() => ratingsForStack({ llmModel: 'unknown', ttsBackend: 'piper', ttsModel: null })).toThrow();
  });
  it('tierById rejects unknown and non-string ids', () => {
    expect(tierById('storm')).toBeUndefined();
    expect(tierById(undefined)).toBeUndefined();
    expect(tierById(5)).toBeUndefined();
  });
  it('every tier stack is accepted by the model catalog validation', () => {
    expect(stackErrors()).toEqual([]);
    for (const t of PRICING_TIERS) {
      expect(validateModelChoice({ voiceEngine: 'poc', llmModel: t.stack.llmModel, ttsModel: t.stack.ttsModel, ttsBackend: t.stack.ttsBackend })).toBeNull();
    }
  });
  it('Lite: gpt-6-luna + Piper; Standard: Gemini 3.1 Flash-Lite + ElevenLabs Flash; Pro: Claude Sonnet 4.6 + ElevenLabs v4 Turbo', () => {
    expect(stackForTier('lite')).toMatchObject({ llmModel: LITE_LLM_MODEL, ttsBackend: 'piper', voiceId: 'custom:en-us-warm-f' });
    expect(stackForTier('standard')).toMatchObject({ llmModel: STANDARD_LLM_MODEL, ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5' });
    expect(stackForTier('pro')).toMatchObject({ llmModel: PRO_LLM_MODEL, ttsBackend: 'elevenlabs', ttsModel: 'eleven_v4_turbo' });
    expect([LITE_LLM_MODEL, STANDARD_LLM_MODEL, PRO_LLM_MODEL]).toEqual(['gpt-6-luna', 'gemini-3.1-flash-lite', 'claude-sonnet-4-6']);
    expect(tierById('pro')!.stack.ttsPromoNote).toMatch(/2026-10-12/);
  });
  it('stackForTier returns a copy and throws on an unknown tier', () => {
    const s = stackForTier('standard'); s.llmModel = 'x';
    expect(stackForTier('standard').llmModel).toBe(STANDARD_LLM_MODEL);
    expect(() => stackForTier('storm')).toThrow(/Unknown tier/);
  });
});

describe('add-ons', () => {
  it('are all proposals, none on by default, sentiment is opt-in, and amounts are unset placeholders', () => {
    expect(ADD_ONS.map((a) => a.id).sort()).toEqual(['advanced_analytics', 'long_prompts', 'premium_voice', 'sentiment_per_turn']);
    for (const a of ADD_ONS) { expect(a.proposed).toBe(true); expect(a.defaultOn).toBe(false); }
  });
});

describe('priceFor', () => {
  it('quotes the base price with a one-line explanation', () => {
    const q = priceFor({ tier: 'standard' });
    expect(q.centsPerMinute).toBe(5);
    expect(q.purchasable).toBe(true);
    expect(q.explanation).toBe('Standard is $0.05 per minute (phone carrier billed separately).');
    expect(priceFor({ tier: 'pro' }).explanation).toBe('Pro is $0.09 per minute (phone carrier billed separately).');
  });
  it('Lite is purchasable at 2 cents', () => {
    const q = priceFor({ tier: 'lite' });
    expect(q.centsPerMinute).toBe(2);
    expect(q.purchasable).toBe(true);
    expect(q.explanation).not.toContain('Coming soon');
  });
  it('an add-on with no amount set adds nothing and is reported as unpriced', () => {
    const q = priceFor({ tier: 'standard', addOns: ['sentiment_per_turn'] });
    expect(q.centsPerMinute).toBe(5);
    expect(q.unpricedAddOns).toEqual(['sentiment_per_turn']);
    expect(q.explanation).toContain('price to be announced');
  });
  it('adds a priced add-on once, even if listed twice (math checked against a temporarily priced add-on)', () => {
    const a = ADD_ONS.find((x) => x.id === 'advanced_analytics')!;
    a.centsPerMinute = 1.5;
    try {
      const q = priceFor({ tier: 'standard', addOns: ['advanced_analytics', 'advanced_analytics'] });
      expect(q.centsPerMinute).toBe(6.5);
      expect(q.unpricedAddOns).toEqual([]);
      expect(q.explanation).toBe('Standard is $0.05 per minute plus Advanced analytics $0.015, $0.065 per minute in all (phone carrier billed separately).');
    } finally { a.centsPerMinute = null; }
  });
  it('throws on an unknown tier or add-on', () => {
    expect(() => priceFor({ tier: 'storm' })).toThrow(/Unknown tier/);
    expect(() => priceFor({ tier: 'pro', addOns: ['nope'] })).toThrow(/Unknown add-on/);
  });
});

describe('legacy agents keep their current price', () => {
  it('maps each voice backend to exactly the flat price on the existing pricing page', () => {
    expect(tierForLegacyConfig(null).centsPerMinute).toBe(10);
    expect(tierForLegacyConfig(undefined).centsPerMinute).toBe(10);
    expect(tierForLegacyConfig('kokoro').centsPerMinute).toBe(10);
    expect(tierForLegacyConfig('elevenlabs').centsPerMinute).toBe(12);
    expect(tierForLegacyConfig('cartesia').centsPerMinute).toBe(12);
    expect(tierForLegacyConfig('minimax').centsPerMinute).toBe(16);
    for (const [backend, dollars] of Object.entries(PRICING.usage.voicePerMinute)) expect(tierForLegacyConfig(backend).centsPerMinute).toBe(Math.round(dollars * 100));
  });
  it('is flagged legacy; no tier is equivalent any more (every tier is bring-your-own carrier)', () => {
    expect(tierForLegacyConfig('kokoro')).toMatchObject({ legacy: true, equivalentTier: null });
    expect(tierForLegacyConfig('elevenlabs').equivalentTier).toBeNull();
    expect(tierForLegacyConfig('minimax').equivalentTier).toBeNull();
  });
  it('an unknown backend falls back to the default voice price rather than inventing one', () => {
    expect(tierForLegacyConfig('mystery').centsPerMinute).toBe(10);
  });
});

describe('resolveTierForPublish', () => {
  it('passes a request with no tier through untouched', () => {
    expect(resolveTierForPublish({ voiceEngine: 'poc', ttsBackend: 'cartesia', llmModel: 'gpt-6-luna' })).toEqual({ ok: true, tier: null, llmModel: 'gpt-6-luna', ttsModel: undefined, ttsBackend: 'cartesia', overrides: [] });
    expect(resolveTierForPublish({ voiceEngine: 'retell' })).toMatchObject({ ok: true, tier: null });
  });
  it('derives the models from the tier when none are given', () => {
    expect(resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc' })).toEqual({ ok: true, tier: 'standard', llmModel: STANDARD_LLM_MODEL, ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5', overrides: [] });
  });
  it('refuses Lite without the quality acceptance, with a clear message', () => {
    const r = resolveTierForPublish({ tier: 'lite', voiceEngine: 'poc' });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/acceptLowerQuality/);
  });
  it('rejects an unknown tier and a tier on the retell engine', () => {
    expect((resolveTierForPublish({ tier: 'storm', voiceEngine: 'poc' }) as { error: string }).error).toMatch(/Unknown tier "storm"/);
    expect((resolveTierForPublish({ tier: 'pro', voiceEngine: 'retell' }) as { error: string }).error).toMatch(/in-house voice engine/);
    expect(resolveTierForPublish({ tier: 'pro' }).ok).toBe(false);
  });
  it('lets explicit models win and records them as overrides', () => {
    const r = resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc', llmModel: 'claude-sonnet-4-6' });
    expect(r).toMatchObject({ ok: true, llmModel: 'claude-sonnet-4-6', ttsModel: 'eleven_flash_v2_5', overrides: ['llmModel'] });
  });
  it('does not carry the tier voice model onto a different explicit backend', () => {
    const r = resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc', ttsBackend: 'cartesia' });
    expect(r).toMatchObject({ ok: true, ttsBackend: 'cartesia', ttsModel: undefined, overrides: ['ttsBackend'] });
  });
  it('explicit values equal to the tier stack are not overrides', () => {
    const r = resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc', llmModel: STANDARD_LLM_MODEL, ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5' });
    expect(r).toMatchObject({ ok: true, overrides: [] });
  });
});

describe('public pricing payload', () => {
  const p = publicPricing();
  it('lists the tiers and add-ons with prices in cents and dollars', () => {
    expect(p.tiers.map((t) => [t.id, t.pricePerMinuteCents, t.pricePerMinuteDollars])).toEqual([['lite', 2, 0.02], ['standard', 5, 0.05], ['pro', 9, 0.09]]);
    expect(p.addOns).toHaveLength(4);
    expect(p.carrierNote).toBe('Bring your own carrier on every plan, or add phone numbers from us.');
    expect(p.tiers.map((t) => t.ratings.voice)).toEqual(['Clear and efficient', 'Natural', 'Most expressive']);
  });
  it('never exposes model names, token talk or the engine stack', () => {
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/stack|llmModel|ttsModel|haiku|sonnet|eleven|kokoro|token|claude|gpt/i);
  });
});

describe('customer-facing files stay free of internal costs', () => {
  it.each(['src/lib/pricingTiers.ts', 'src/components/flow-builder/TierPicker.tsx', 'src/app/pricing/page.tsx'])('%s has no cost or margin language', (f) => {
    const text = readFileSync(join(process.cwd(), f), 'utf8');
    expect(text).not.toMatch(/margin|wholesale|our cost|cost to serve|costs us|per million/i);
  });
});

describe('lowerQuality tier acceptance', () => {
  it('Lite runs on Piper and is flagged lower quality; Standard and Pro are not', () => {
    expect(tierById('lite')?.lowerQuality).toBe(true);
    expect(tierById('standard')?.lowerQuality).toBeFalsy();
    expect(tierById('pro')?.lowerQuality).toBeFalsy();
  });
  it('refuses a lowerQuality tier unless the quality tradeoff was accepted (once it is on sale)', () => {
    const lite = PRICING_TIERS.find((t) => t.id === 'lite')!;
    const was = lite.availability;
    lite.availability = 'live';
    try {
      const no = resolveTierForPublish({ tier: 'lite', voiceEngine: 'poc' });
      expect(no.ok).toBe(false);
      expect((no as { error: string }).error).toMatch(/acceptLowerQuality/);
      const yes = resolveTierForPublish({ tier: 'lite', voiceEngine: 'poc', acceptLowerQuality: true });
      expect(yes).toMatchObject({ ok: true, tier: 'lite', ttsBackend: 'piper' });
      expect(resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc' }).ok).toBe(true);
    } finally {
      lite.availability = was;
    }
  });
});

describe('tier voice', () => {
  it('Lite speaks the Kokoro-distilled Piper voice on its own backend; Standard and Pro set no voice', () => {
    const lite = PRICING_TIERS.find((t) => t.id === 'lite')!;
    expect(lite.stack.voiceId).toBe('custom:en-us-warm-f');
    expect(resolveTierForPublish({ tier: 'lite', voiceEngine: 'poc', acceptLowerQuality: true })).toMatchObject({ ok: true, voiceId: 'custom:en-us-warm-f' });
    expect(resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc' })).toMatchObject({ ok: true, voiceId: undefined });
  });
  it('the tier voice is not applied when the backend is overridden', () => {
    expect(resolveTierForPublish({ tier: 'lite', voiceEngine: 'poc', acceptLowerQuality: true, ttsBackend: 'elevenlabs' })).toMatchObject({ ok: true, voiceId: undefined });
  });
});


describe('Lite languages on Piper', () => {
  it('Lite voice per language: default first, alternate second, exactly de/es/fr/it/pt-BR', () => {
    expect(LITE_LANGUAGE_VOICES).toEqual({
      de: 'custom:de-de-mls-f', es: 'custom:es-pilot-f', fr: 'custom:fr-fr-mls-f', it: 'custom:it-it-serena', 'pt-BR': 'custom:pt-br-faber',
    });
    expect(PIPER_LANGUAGE_VOICES).toEqual({
      de: ['custom:de-de-mls-f', 'custom:de-de-mls-m'],
      es: ['custom:es-pilot-f', 'custom:es-pilot-m'],
      fr: ['custom:fr-fr-mls-f', 'custom:fr-fr-mls-m'],
      it: ['custom:it-it-serena', 'custom:it-it-paola'],
      'pt-BR': ['custom:pt-br-faber', 'custom:pt-br-cadu'],
    });
  });
  it('every Lite voice is a custom: id and its language is a real agent language', () => {
    const codes = AGENT_LANGUAGES.map((l) => l.code);
    for (const [code, voice] of Object.entries(LITE_LANGUAGE_VOICES)) {
      expect(voice.startsWith('custom:')).toBe(true);
      expect(codes).toContain(code);
    }
  });
  it('English voice stays custom:en-us-warm-f', () => {
    expect(stackForTier('lite').voiceId).toBe('custom:en-us-warm-f');
  });
  it('tierVoiceLanguages: Lite lists English plus the five; Standard, Pro and unknown ids are unrestricted (null)', () => {
    expect(tierVoiceLanguages('lite')).toEqual(['en', 'de', 'es', 'fr', 'it', 'pt-BR']);
    expect(tierVoiceLanguages('standard')).toBeNull();
    expect(tierVoiceLanguages('pro')).toBeNull();
    expect(tierVoiceLanguages('storm')).toBeNull();
    expect(tierVoiceLanguages(undefined)).toBeNull();
  });
  it('tierVoiceSupportsLanguage', () => {
    for (const c of ['en', 'de', 'es', 'fr', 'it', 'pt-BR']) expect(tierVoiceSupportsLanguage('lite', c)).toBe(true);
    for (const c of ['nl', 'hi', 'ja', 'pl', 'ar']) expect(tierVoiceSupportsLanguage('lite', c)).toBe(false);
    expect(tierVoiceSupportsLanguage('standard', 'nl')).toBe(true);
    expect(tierVoiceSupportsLanguage('pro', 'ja')).toBe(true);
    expect(tierVoiceSupportsLanguage(undefined, 'nl')).toBe(true);
    expect(tierVoiceSupportsLanguage('', 'nl')).toBe(true);
  });
  it('piperVoiceLanguage maps voice ids to languages, English voices to en, others to null', () => {
    expect(piperVoiceLanguage('custom:de-de-mls-m')).toBe('de');
    expect(piperVoiceLanguage('custom:pt-br-cadu')).toBe('pt-BR');
    expect(piperVoiceLanguage('custom:en-us-warm-f')).toBe('en');
    expect(piperVoiceLanguage('af_heart')).toBeNull();
    expect(piperVoiceLanguage('')).toBeNull();
  });
  it('PIPER_LANGUAGES (languages.ts) lists the five non-English codes', () => {
    expect([...PIPER_LANGUAGES].sort()).toEqual(['de', 'es', 'fr', 'it', 'pt-BR']);
  });
  it('the sentence of covered languages', () => {
    expect(piperLanguageSentence()).toBe('English, German, Spanish, French, Italian and Portuguese');
  });
  it('resolveTierForPublish stamps the language voice for Lite and keeps English on warm-f', () => {
    const base = { tier: 'lite', voiceEngine: 'poc', acceptLowerQuality: true } as const;
    expect(resolveTierForPublish({ ...base, language: 'es' })).toMatchObject({ ok: true, voiceId: 'custom:es-pilot-f', ttsBackend: 'piper' });
    expect(resolveTierForPublish({ ...base, language: 'pt-BR' })).toMatchObject({ ok: true, voiceId: 'custom:pt-br-faber' });
    expect(resolveTierForPublish({ ...base, language: 'en' })).toMatchObject({ ok: true, voiceId: 'custom:en-us-warm-f' });
    expect(resolveTierForPublish({ ...base })).toMatchObject({ ok: true, voiceId: 'custom:en-us-warm-f' });
    expect(resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc', language: 'es' })).toMatchObject({ ok: true, voiceId: undefined });
  });
});
