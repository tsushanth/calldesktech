import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  EXPERT_BACKUP, EXPERT_BACKUP_CENTS_PER_MINUTE, EXPERT_BACKUP_METER_EVENT, expertBackupPriceId, expertBackupBillingConfigured,
  expertBackupTerms, expertBackupToggleLabel, resolveExpertBackupForPublish, publicExpertBackup,
} from '@/lib/expertBackup';
import { carryOverFromVersion } from '@/lib/versionCarryOver';
import { buildSettingsVersionPayload } from '@/lib/settingsVersionPayload';
import { EXPERT_BACKUP_LINE, pricingPlainText } from '@/lib/pricingCopy';
import { PricingContent } from '@/components/pricing/PricingContent';
import ExpertBackupToggle from '@/components/flow-builder/ExpertBackupToggle';
import { GET as pricingGET } from '@/app/api/pricing/route';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

beforeEach(() => { delete process.env.STRIPE_PRICE_EXPERT_BACKUP; });

describe('the price is one constant', () => {
  it('is 1.5 cents per minute and the Stripe unit is derived consistently (0.025 cents a second)', () => {
    expect(EXPERT_BACKUP_CENTS_PER_MINUTE).toBe(1.5);
    expect(EXPERT_BACKUP.centsPerMinute).toBe(EXPERT_BACKUP_CENTS_PER_MINUTE);
    expect(EXPERT_BACKUP_CENTS_PER_MINUTE / 60).toBeCloseTo(0.025, 10);
    expect(EXPERT_BACKUP_METER_EVENT).toBe('calldesktech_expert_backup_seconds');
    expect([...EXPERT_BACKUP.allowedTiers]).toEqual(['lite', 'standard']);
    expect(EXPERT_BACKUP.expertModel).toBe('Claude Sonnet');
  });
  it('the label, terms, plain text line and API all show the constant', () => {
    expect(expertBackupToggleLabel()).toBe('Expert backup, +1.5¢ per minute');
    expect(expertBackupTerms()).toContain('1.5 cents per minute');
    expect(EXPERT_BACKUP_LINE).toContain('1.5 cents more per minute');
    expect(pricingPlainText()).toContain(EXPERT_BACKUP_LINE);
    expect(publicExpertBackup()).toMatchObject({ id: 'expert_backup', label: 'Expert backup', availability: 'live', centsPerMinute: 1.5, tiers: ['lite', 'standard'] });
    expect(JSON.stringify(publicExpertBackup())).not.toMatch(/sonnet|claude/i);
    expect(read('public/llms.txt')).toContain(EXPERT_BACKUP_LINE);
  });
  it('no source file other than the constants file types the number', () => {
    for (const f of ['src/components/pricing/PricingParts.tsx', 'src/components/flow-builder/ExpertBackupToggle.tsx', 'src/lib/pricingCopy.ts', 'src/app/api/agents/[id]/versions/route.ts', 'src/lib/reportUsageToStripe.ts']) {
      expect(read(f), f).not.toMatch(/1\.5\s*(¢|cents?)/);
    }
  });
});

describe('env var fails closed', () => {
  it('unset or blank means not configured', () => {
    expect(expertBackupPriceId()).toBeNull();
    process.env.STRIPE_PRICE_EXPERT_BACKUP = '   ';
    expect(expertBackupBillingConfigured()).toBe(false);
    process.env.STRIPE_PRICE_EXPERT_BACKUP = ' price_x ';
    expect(expertBackupPriceId()).toBe('price_x');
  });
});

describe('resolveExpertBackupForPublish', () => {
  const ok = { voiceEngine: 'poc', tier: 'standard' as const, acceptExpertBackup: true };
  it('absent or null is standard routing', () => {
    expect(resolveExpertBackupForPublish({ voiceEngine: 'retell', tier: null })).toEqual({ ok: true, routingMode: null });
    expect(resolveExpertBackupForPublish({ routingMode: null, voiceEngine: 'poc', tier: 'pro' })).toEqual({ ok: true, routingMode: null });
  });
  it('accepts expert_backup on lite and standard with acceptance', () => {
    expect(resolveExpertBackupForPublish({ ...ok, routingMode: 'expert_backup' })).toEqual({ ok: true, routingMode: 'expert_backup' });
    expect(resolveExpertBackupForPublish({ ...ok, tier: 'lite', routingMode: 'expert_backup' })).toEqual({ ok: true, routingMode: 'expert_backup' });
  });
  it('refuses Pro, no tier, retell, unknown modes and missing acceptance with clear codes', () => {
    const code = (i: Parameters<typeof resolveExpertBackupForPublish>[0]) => { const r = resolveExpertBackupForPublish(i); return r.ok ? 'ok' : r.code; };
    expect(code({ ...ok, tier: 'pro', routingMode: 'expert_backup' })).toBe('expert_backup_tier_not_allowed');
    expect(code({ ...ok, tier: null, routingMode: 'expert_backup' })).toBe('expert_backup_tier_not_allowed');
    expect(code({ ...ok, voiceEngine: 'retell', routingMode: 'expert_backup' })).toBe('expert_backup_needs_poc_engine');
    expect(code({ ...ok, routingMode: 'turbo' })).toBe('invalid_routing_mode');
    expect(code({ ...ok, acceptExpertBackup: undefined, routingMode: 'expert_backup' })).toBe('expert_backup_acceptance_required');
    expect(code({ ...ok, acceptExpertBackup: 'true', routingMode: 'expert_backup' })).toBe('expert_backup_acceptance_required');
    const r = resolveExpertBackupForPublish({ ...ok, acceptExpertBackup: false, routingMode: 'expert_backup' });
    expect(!r.ok && r.error).toContain(expertBackupTerms());
  });
});

describe('restore and copy preserve the mode', () => {
  const v = { voice_engine: 'poc', tier: 'standard', routing_mode: 'expert_backup', llm_model: null, tts_model: null };
  it('carries routingMode with its acceptance', () => {
    const { body, dropped } = carryOverFromVersion(v);
    expect(body).toMatchObject({ routingMode: 'expert_backup', acceptExpertBackup: true, tier: 'standard' });
    expect(dropped).toEqual([]);
  });
  it('a standard-routing version carries nothing', () => {
    const { body } = carryOverFromVersion({ ...v, routing_mode: null });
    expect(body.routingMode).toBeUndefined();
    expect(body.acceptExpertBackup).toBeUndefined();
  });
  it('is dropped (and named) when the tier or engine no longer allows it', () => {
    expect(carryOverFromVersion({ ...v, tier: 'pro' })).toMatchObject({ body: { routingMode: undefined }, dropped: ['routingMode'] });
    expect(carryOverFromVersion({ ...v, tier: null }).dropped).toContain('routingMode');
    expect(carryOverFromVersion({ ...v, voice_engine: 'retell' }).dropped).toContain('routingMode');
  });
  it('the Settings wizard keeps it on the next version', () => {
    const p = buildSettingsVersionPayload({ previous: v, voiceEngine: 'poc', ttsBackend: 'elevenlabs', flowName: 'x', startNodeId: 's', nodes: [], wizardConfig: {} });
    expect(p).toMatchObject({ routingMode: 'expert_backup', acceptExpertBackup: true, tier: 'standard' });
  });
});

describe('surfaces', () => {
  it('GET /api/pricing exposes the extra', async () => {
    const body = await (await pricingGET()).json();
    expect(body.expertBackup).toMatchObject({ id: 'expert_backup', centsPerMinute: 1.5, tiers: ['lite', 'standard'], availability: 'live' });
    expect(body.expertBackup.terms).toBe(expertBackupTerms());
  });
  it('the pricing page lists it as a live priced extra while the other add-ons stay coming soon', () => {
    const html = renderToStaticMarkup(createElement(PricingContent, { cta: createElement('button', null, 'Go') }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('data-testid="extras-expert-backup"');
    expect(text).toContain('Expert backup');
    expect(text).toContain('+1.5¢ per minute');
    expect(text).toContain('better accuracy on hard turns');
    expect(text).toContain('Optional add-ons, coming soon');
  });
  it('OpenAPI and the MCP tool describe the new fields and the price', () => {
    const o = read('src/lib/openapi.ts'); const m = read('src/lib/mcp/tools.ts');
    for (const src of [o, m]) { expect(src).toContain('routingMode'); expect(src).toContain('acceptExpertBackup'); }
  });
  it('docs describe it', () => {
    const d = read('docs/tiered-billing.md');
    expect(d).toContain('STRIPE_PRICE_EXPERT_BACKUP');
    expect(d).toContain('calldesktech_expert_backup_seconds');
    expect(d).toContain('Removal rule');
  });
  it('the regression harness has the --routing flag', () => {
    expect(read('scripts/regression/run.mjs')).toContain("val('routing'");
    expect(read('scripts/regression/lib.mjs')).toMatch(/routingMode: 'expert_backup', acceptExpertBackup: true/);
  });
});

describe('builder toggle', () => {
  const render = (p: { voiceEngine: string; tier: string; enabled?: boolean }) =>
    renderToStaticMarkup(createElement(ExpertBackupToggle, { voiceEngine: p.voiceEngine, tier: p.tier, enabled: !!p.enabled, accepted: false, onEnabledChange: () => {}, onAcceptedChange: () => {} }));
  it('shows the priced label on poc with lite or standard', () => {
    for (const tier of ['lite', 'standard']) expect(render({ voiceEngine: 'poc', tier })).toContain('Expert backup, +1.5¢ per minute');
  });
  it('is hidden on Pro, with no tier and on retell', () => {
    expect(render({ voiceEngine: 'poc', tier: 'pro' })).toBe('');
    expect(render({ voiceEngine: 'poc', tier: '' })).toBe('');
    expect(render({ voiceEngine: 'retell', tier: 'standard' })).toBe('');
  });
  it('asks for acceptance only once switched on', () => {
    expect(render({ voiceEngine: 'poc', tier: 'standard' })).not.toContain('expert-backup-accept');
    expect(render({ voiceEngine: 'poc', tier: 'standard', enabled: true })).toContain('expert-backup-accept');
  });
  it('the builder sends the fields only when active and accepted, and shows the mode in version history', () => {
    const page = read('src/app/dashboard/agents/[id]/page.tsx');
    expect(page).toContain("routingMode: EXPERT_BACKUP.id, acceptExpertBackup: true");
    expect(page).toContain('expertBackupActive && expertBackupAccepted');
    expect(page).toContain('isRoutingMode(v.routing_mode)');
  });
});
