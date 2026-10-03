import { describe, expect, it } from 'vitest';
import { normalizeFreightPhone } from '@/lib/outreach/freight';

// scripts/backfill-freight-phones.mjs is an untyped ES module; load it dynamically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import('../../scripts/backfill-freight-phones.mjs');

const lead = (id: string, mc: string, extra: Record<string, unknown> = {}) => ({ id, source_key: `freight:mc:${mc}`, phone: null, company_name: 'County Line Transport Inc', signals: {}, ...extra });

describe('backfill-freight-phones planPage', () => {
  it('plans a phone for each matching lead missing one, normalized to E.164', async () => {
    const { planPage } = await load();
    const plan = planPage(
      [{ docket_number: 'MC443795', bus_telno: '6305546101' }, { docket_number: 'MC009153', bus_telno: '(203) 265-0921' }],
      [lead('l1', '443795'), lead('l2', '9153'), lead('l3', '777777')],
    );
    expect(plan.updates).toEqual([{ id: 'l1', mc: '443795', phone: '+16305546101' }, { id: 'l2', mc: '9153', phone: '+12032650921' }]);
    expect(plan.skipped.noMatch).toBe(1);
  });
  it('skips invalid FMCSA numbers, and counts them', async () => {
    const { planPage } = await load();
    const plan = planPage([{ docket_number: 'MC1000', bus_telno: '0000000000' }, { docket_number: 'MC1001', bus_telno: '555' }], [lead('l1', '1000'), lead('l2', '1001')]);
    expect(plan.updates).toEqual([]);
    expect(plan.invalid).toBe(2);
  });
  it('is idempotent: never plans an overwrite of an existing phone', async () => {
    const { planPage } = await load();
    const plan = planPage([{ docket_number: 'MC1000', bus_telno: '6305546101' }], [lead('l1', '1000', { phone: '+15555550100' })]);
    expect(plan.updates).toEqual([]);
  });
  it('only touches FMCSA-keyed (US) freight leads, never DVSA/Norway ones', async () => {
    const { planPage } = await load();
    const plan = planPage([{ docket_number: 'MC1000', bus_telno: '6305546101' }], [{ ...lead('l1', '1000'), source_key: 'freight:no:1000' }, { ...lead('l2', '1000'), source_key: 'freight:gb-dvsa:1000' }]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped.notFmcsaKey).toBe(2);
  });
  it('honours the personal-line policy (flagged or person-named leads get no phone)', async () => {
    const { planPage } = await load();
    const plan = planPage(
      [{ docket_number: 'MC1000', bus_telno: '6305546101' }, { docket_number: 'MC1001', bus_telno: '6305546102' }, { docket_number: 'MC1002', bus_telno: '6305546103' }],
      [lead('l1', '1000', { signals: { registry: { callerPhoneExcluded: 'sole proprietor' } } }), lead('l2', '1001', { company_name: 'JOHN A SMITH' }), lead('l3', '1002')],
    );
    expect(plan.updates.map((u: { id: string }) => u.id)).toEqual(['l3']);
    expect(plan.skipped.excludedPersonal).toBe(2);
  });
  it('mcOf parses dockets like the discovery code', async () => {
    const { mcOf } = await load();
    expect(mcOf('MC012892')).toBe('12892');
    expect(mcOf('FF123')).toBeNull();
    expect(mcOf(undefined)).toBeNull();
  });
  it('uses the same phone normalization as discovery', async () => {
    const mod = await load();
    for (const raw of ['6305546101', '(630) 554-6101', '1-630-554-6101', '0000000000', '555', null, '9005551234']) {
      expect(mod.normalizeFreightPhone(raw)).toBe(normalizeFreightPhone(raw));
    }
  });
});
