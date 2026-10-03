import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PricingContent } from '@/components/pricing/PricingContent';
import { parsePlan, initialTierForBuilder, readStoredPlan, storePlan, clearStoredPlan, PLAN_STORAGE_KEY } from '@/lib/planSelection';
import { PRICING_TIERS } from '@/lib/pricingTiers';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

describe('plan validation', () => {
  it('accepts only the three tier ids', () => {
    for (const id of ['lite', 'standard', 'pro']) expect(parsePlan(id)).toBe(id);
    for (const junk of ['', 'Lite', 'enterprise', '<script>', null, undefined, 3, ['lite']]) expect(parsePlan(junk)).toBeNull();
  });
});

describe('builder preselect', () => {
  it('preselects a valid live plan', () => {
    expect(initialTierForBuilder({ storedPlan: 'standard' })).toBe('standard');
    expect(initialTierForBuilder({ storedPlan: 'pro' })).toBe('pro');
  });
  it('preselects Lite as a tier only; acceptance is not part of the result', () => {
    expect(initialTierForBuilder({ storedPlan: 'lite' })).toBe('lite');
    expect(read('src/lib/planSelection.ts')).not.toMatch(/acceptLowerQuality|lowerQualityAccepted/);
  });
  it('ignores invalid or missing plans', () => {
    expect(initialTierForBuilder({ storedPlan: 'junk' })).toBe('');
    expect(initialTierForBuilder({ storedPlan: null })).toBe('');
    expect(initialTierForBuilder({})).toBe('');
  });
  it('ignores a plan that is not live', () => {
    const t = PRICING_TIERS.find((x) => x.id === 'pro')!;
    const orig = t.availability;
    t.availability = 'coming_soon';
    try { expect(initialTierForBuilder({ storedPlan: 'pro' })).toBe(''); } finally { t.availability = orig; }
  });
  it('a saved tier wins over the stored plan', () => {
    expect(initialTierForBuilder({ savedTier: 'pro', storedPlan: 'lite' })).toBe('pro');
  });
  it('the builder never ticks the Lite acceptance from the plan', () => {
    const page = read('src/app/dashboard/agents/[id]/page.tsx');
    expect(page).not.toMatch(/setLowerQualityAccepted\(true\)/);
    expect(page).toContain('initialTierForBuilder');
  });
});

describe('plan storage', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('round-trips and tolerates blocked storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
    storePlan('pro');
    expect(store.get(PLAN_STORAGE_KEY)).toBe('pro');
    expect(readStoredPlan()).toBe('pro');
    store.set(PLAN_STORAGE_KEY, 'junk');
    expect(readStoredPlan()).toBeNull();
    clearStoredPlan();
    expect(store.has(PLAN_STORAGE_KEY)).toBe(false);
    const boom = () => { throw new Error('blocked'); };
    vi.stubGlobal('window', { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(() => { storePlan('lite'); clearStoredPlan(); }).not.toThrow();
    expect(readStoredPlan()).toBeNull();
  });
});

describe('/pricing plan CTAs', () => {
  const html = renderToStaticMarkup(createElement(PricingContent, {
    cta: createElement('button', null, 'Get Started'),
    planCta: (plan) => createElement('button', { 'data-plan': plan }, `Start with ${plan}`),
  }));
  it('renders one CTA per plan with distinct plan ids, and keeps the voice-quality note', () => {
    const ids = [...html.matchAll(/data-plan="(\w+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['lite', 'standard', 'pro']);
    expect(html).toContain('data-testid="voice-quality-note"');
  });
  it('wiring: page passes PlanButton per plan; content stays a server component', () => {
    expect(read('src/components/pricing/PricingContent.tsx')).not.toMatch(/use client|useSession/);
    const page = read('src/app/pricing/page.tsx');
    expect(page).toContain('<PlanButton plan={plan} />');
    expect(page).toContain('<PlanFromQuery />');
    expect(read('src/components/pricing/PlanButton.tsx')).toMatch(/^'use client'/);
    expect(read('src/components/pricing/PlanButton.tsx')).toContain('Start with ${name}');
  });
});
