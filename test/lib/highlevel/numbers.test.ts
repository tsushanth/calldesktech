import { describe, it, expect, vi, beforeEach } from 'vitest';

let rows: Array<{ id: string; number: string }> = [];
const filters: Array<[string, unknown]> = [];
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
        not: (k: string, op: string, v: unknown) => { filters.push([`not ${k} ${op}`, v]); return b; },
        then: (res: (v: unknown) => unknown) => res({ data: rows }),
      };
      return b;
    },
  }),
}));
import { resolveFromNumber } from '@/lib/highlevel/numbers';

beforeEach(() => { rows = []; filters.length = 0; });

describe('resolveFromNumber', () => {
  it('only looks at the workspace\'s numbers that have an Outbound Call Agent', async () => {
    rows = [{ id: 'n1', number: '+14155550100' }];
    await resolveFromNumber('tenant_1');
    expect(filters).toContainEqual(['tenant_id', 'tenant_1']);
    expect(filters).toContainEqual(['not outbound_agent_version_id is', null]);
  });
  it('uses the only outbound number when none is asked for', async () => {
    rows = [{ id: 'n1', number: '+14155550100' }];
    expect(await resolveFromNumber('t')).toEqual({ ok: true, phoneNumberId: 'n1' });
  });
  it('says so when there is no outbound number', async () => {
    expect(await resolveFromNumber('t')).toMatchObject({ ok: false, error: expect.stringContaining('no phone number') });
  });
  it('asks the author to choose when there are several, listing them', async () => {
    rows = [{ id: 'n1', number: '+14155550100' }, { id: 'n2', number: '+14155550101' }];
    const r = await resolveFromNumber('t');
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain('+14155550100');
    expect((r as { error: string }).error).toContain('+14155550101');
  });
  it('matches a requested number however it is typed, and refuses one that is not the workspace\'s', async () => {
    rows = [{ id: 'n1', number: '+14155550100' }, { id: 'n2', number: '+14155550101' }];
    expect(await resolveFromNumber('t', '(415) 555-0101')).toEqual({ ok: true, phoneNumberId: 'n2' });
    expect(await resolveFromNumber('t', '+14155550101')).toEqual({ ok: true, phoneNumberId: 'n2' });
    expect(await resolveFromNumber('t', '+12125550000')).toMatchObject({ ok: false, error: expect.stringContaining('not one of') });
    expect(await resolveFromNumber('t', 'garbage')).toMatchObject({ ok: false });
  });
});
