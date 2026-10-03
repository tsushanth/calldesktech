import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRICING } from '@/lib/constants';
import { DEFAULT_LLM_MODEL } from '@/lib/modelCatalog';
import {
  ADD_ONS, PRICING_TIERS, TIER_IDS, priceFor, publicPricing, resolveTierForPublish, stackErrors, stackForTier, tierById, tierForLegacyConfig,
} from '@/lib/pricingTiers';

describe('pricing tiers', () => {
  it('has exactly Lite, Standard and Pro at 2, 6 and 10 cents per minute', () => {
    expect(PRICING_TIERS.map((t) => [t.id, t.pricePerMinuteCents])).toEqual([['lite', 2], ['standard', 6], ['pro', 10]]);
    expect([...TIER_IDS]).toEqual(['lite', 'standard', 'pro']);
  });
  it('Lite and Standard bring your own carrier; Pro includes managed phone service', () => {
    expect(tierById('lite')!.carrierMode).toBe('byo');
    expect(tierById('standard')!.carrierMode).toBe('byo');
    expect(tierById('pro')!.carrierMode).toBe('managed');
  });
  it('only Lite is coming soon', () => {
    expect(PRICING_TIERS.filter((t) => t.availability === 'coming_soon').map((t) => t.id)).toEqual(['lite']);
  });
  it('every tier includes summary, transcript and structured extraction', () => {
    for (const t of PRICING_TIERS) {
      expect(t.includes.join(' ')).toMatch(/summary/i);
      expect(t.includes.join(' ')).toMatch(/transcript/i);
      expect(t.includes.join(' ')).toMatch(/extraction/i);
    }
  });
  it('tierById rejects unknown and non-string ids', () => {
    expect(tierById('storm')).toBeUndefined();
    expect(tierById(undefined)).toBeUndefined();
    expect(tierById(5)).toBeUndefined();
  });
  it('every tier stack is accepted by the model catalog validation', () => {
    expect(stackErrors()).toEqual([]);
  });
  it('Standard runs Claude Haiku with ElevenLabs Flash; Pro uses the more expressive voice', () => {
    expect(stackForTier('standard')).toMatchObject({ llmModel: DEFAULT_LLM_MODEL, ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5' });
    expect(stackForTier('pro')).toMatchObject({ ttsBackend: 'elevenlabs', ttsModel: 'eleven_v4_turbo' });
    expect(stackForTier('lite').ttsBackend).toBe('kokoro');
  });
  it('stackForTier returns a copy and throws on an unknown tier', () => {
    const s = stackForTier('standard'); s.llmModel = 'x';
    expect(stackForTier('standard').llmModel).toBe(DEFAULT_LLM_MODEL);
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
    expect(q.centsPerMinute).toBe(6);
    expect(q.purchasable).toBe(true);
    expect(q.explanation).toBe('Standard is $0.06 per minute (phone carrier billed separately).');
    expect(priceFor({ tier: 'pro' }).explanation).toBe('Pro is $0.10 per minute (phone service included).');
  });
  it('marks Lite as coming soon and not purchasable', () => {
    const q = priceFor({ tier: 'lite' });
    expect(q.centsPerMinute).toBe(2);
    expect(q.purchasable).toBe(false);
    expect(q.explanation).toContain('Coming soon');
  });
  it('an add-on with no amount set adds nothing and is reported as unpriced', () => {
    const q = priceFor({ tier: 'standard', addOns: ['sentiment_per_turn'] });
    expect(q.centsPerMinute).toBe(6);
    expect(q.unpricedAddOns).toEqual(['sentiment_per_turn']);
    expect(q.explanation).toContain('price to be announced');
  });
  it('adds a priced add-on once, even if listed twice (math checked against a temporarily priced add-on)', () => {
    const a = ADD_ONS.find((x) => x.id === 'advanced_analytics')!;
    a.centsPerMinute = 1.5;
    try {
      const q = priceFor({ tier: 'standard', addOns: ['advanced_analytics', 'advanced_analytics'] });
      expect(q.centsPerMinute).toBe(7.5);
      expect(q.unpricedAddOns).toEqual([]);
      expect(q.explanation).toBe('Standard is $0.06 per minute plus Advanced analytics $0.015, $0.075 per minute in all (phone carrier billed separately).');
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
  it('is flagged legacy; only the $0.10 default voice has an equivalent tier (Pro)', () => {
    expect(tierForLegacyConfig('kokoro')).toMatchObject({ legacy: true, equivalentTier: 'pro' });
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
    expect(resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc' })).toEqual({ ok: true, tier: 'standard', llmModel: DEFAULT_LLM_MODEL, ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5', overrides: [] });
  });
  it('rejects Lite with a clear coming-soon message', () => {
    const r = resolveTierForPublish({ tier: 'lite', voiceEngine: 'poc' });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/Lite tier is coming soon/);
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
    const r = resolveTierForPublish({ tier: 'standard', voiceEngine: 'poc', llmModel: DEFAULT_LLM_MODEL, ttsBackend: 'elevenlabs', ttsModel: 'eleven_flash_v2_5' });
    expect(r).toMatchObject({ ok: true, overrides: [] });
  });
});

describe('public pricing payload', () => {
  const p = publicPricing();
  it('lists the tiers and add-ons with prices in cents and dollars', () => {
    expect(p.tiers.map((t) => [t.id, t.pricePerMinuteCents, t.pricePerMinuteDollars])).toEqual([['lite', 2, 0.02], ['standard', 6, 0.06], ['pro', 10, 0.1]]);
    expect(p.addOns).toHaveLength(4);
    expect(p.carrierNote).toMatch(/Carrier billed separately/);
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
