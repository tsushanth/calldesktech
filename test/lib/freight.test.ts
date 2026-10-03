import { afterEach, describe, expect, it } from 'vitest';
import { armForLead, computeArmStats, freightExperimentOn, isFreightProduct, isUsFreightLead, normalizeFreightPhone, passesFreightUsGuard, pickFreightArm } from '@/lib/outreach/freight';

describe('isUsFreightLead (US brokers only)', () => {
  it('accepts FMCSA broker leads', () => {
    expect(isUsFreightLead({ source_key: 'freight:mc:443795', location: 'Cole Camp, MO' })).toBe(true);
    expect(isUsFreightLead({ source_key: 'freight:mc:1', location: null })).toBe(true);
  });
  it('rejects every other freight source key (UK DVSA, Norway, anything new)', () => {
    expect(isUsFreightLead({ source_key: 'freight:gb-dvsa:OB1234567', location: 'Leeds' })).toBe(false);
    expect(isUsFreightLead({ source_key: 'freight:no:912345678', location: 'Oslo' })).toBe(false);
    expect(isUsFreightLead({ source_key: 'freight:de:1' })).toBe(false);
  });
  it('rejects held / region-blocked leads and leads carrying the international hold, even on an FMCSA key', () => {
    expect(isUsFreightLead({ source_key: 'freight:mc:1', region_blocked: true })).toBe(false);
    expect(isUsFreightLead({ source_key: 'freight:mc:1', signals: { intlHold: { country: 'NO' } } })).toBe(false);
    // a released Norway lead is still not a US lead
    expect(isUsFreightLead({ source_key: 'freight:no:9', region_blocked: false, signals: { intlHold: { country: 'NO' } } })).toBe(false);
  });
  it('without a registry key requires a US state in the location and no foreign TLD', () => {
    expect(isUsFreightLead({ source_key: null, location: 'Austin, TX' })).toBe(true);
    expect(isUsFreightLead({ source_key: null, location: 'Austin, TX', domain: 'acme.no' })).toBe(false);
    expect(isUsFreightLead({ source_key: null, location: 'Austin, TX', contact_email: 'a@acme.co.uk' })).toBe(false);
    expect(isUsFreightLead({ source_key: null, location: 'Toronto, ON' })).toBe(false);
    expect(isUsFreightLead({ source_key: null, location: null })).toBe(false);
    expect(isUsFreightLead({ source_key: null, location: 'Oslo' })).toBe(false);
    expect(isUsFreightLead({ source_key: null, location: 'Somewhere', signals: { registry: { state: 'FL' } } })).toBe(true);
  });
  it('passesFreightUsGuard only constrains freight', () => {
    const norway = { source_key: 'dental:no:1', location: 'Oslo' };
    expect(passesFreightUsGuard('calldesk:dental', norway)).toBe(true);
    expect(passesFreightUsGuard('freight', { source_key: 'freight:no:1' })).toBe(false);
    expect(passesFreightUsGuard('calldesk:freight', { source_key: 'freight:no:1' })).toBe(false);
    expect(isFreightProduct('calldesk')).toBe(false);
  });
});

describe('normalizeFreightPhone (E.164 US)', () => {
  it('normalizes common formats', () => {
    expect(normalizeFreightPhone('6305546101')).toBe('+16305546101');
    expect(normalizeFreightPhone('(630) 554-6101')).toBe('+16305546101');
    expect(normalizeFreightPhone('1-630-554-6101')).toBe('+16305546101');
    expect(normalizeFreightPhone('+1 630 554 6101')).toBe('+16305546101');
  });
  it('rejects implausible numbers', () => {
    for (const bad of ['', null, undefined, '555', '0000000000', '1111111111', '0305546101', '1305546101', '6300546101', '9005551234', '2125550123', '+4420794607', '63055461011']) {
      expect(normalizeFreightPhone(bad as string), String(bad)).toBeNull();
    }
  });
});

describe('experiment arm', () => {
  afterEach(() => { delete process.env.OUTREACH_FREIGHT_EXPERIMENT; });
  it('is deterministic and split roughly 50/50 by lead id', () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const arms = ids.map(pickFreightArm);
    expect(ids.map(pickFreightArm)).toEqual(arms);
    const free = arms.filter((a) => a === 'free_week').length;
    expect(free).toBeGreaterThan(1850);
    expect(free).toBeLessThan(2150);
    expect(new Set(arms)).toEqual(new Set(['free_week', 'demo']));
  });
  it('is off by default and only applies to freight when OUTREACH_FREIGHT_EXPERIMENT=on', () => {
    expect(freightExperimentOn()).toBe(false);
    expect(armForLead('freight', 'abc')).toBeNull();
    process.env.OUTREACH_FREIGHT_EXPERIMENT = 'on';
    expect(armForLead('freight', 'abc')).toBe(pickFreightArm('abc'));
    expect(armForLead('calldesk:freight', 'abc')).toBe(pickFreightArm('abc'));
    expect(armForLead('calldesk:dental', 'abc')).toBeNull();
    expect(armForLead('calldesk', 'abc')).toBeNull();
  });
  it('computes per-arm reply attribution', () => {
    expect(computeArmStats([
      { experiment_arm: 'demo', replied: true }, { experiment_arm: 'demo' }, { experiment_arm: 'free_week', replied: true },
      { experiment_arm: 'free_week', replied: true }, { experiment_arm: 'free_week' }, { experiment_arm: null, replied: true },
    ])).toEqual([
      { arm: 'demo', sent: 2, replied: 1, replyRate: 0.5 },
      { arm: 'free_week', sent: 3, replied: 2, replyRate: 2 / 3 },
    ]);
    expect(computeArmStats([])).toEqual([]);
  });
});
