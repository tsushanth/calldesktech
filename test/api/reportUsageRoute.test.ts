import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/outreach/adminAuth', () => ({
  isCronRequest: (req: Request) => req.headers.get('authorization') === 'Bearer test-cron-secret',
  requireAdminSession: vi.fn(async () => null),
}));

type TenantRow = { id: string; last_usage_reported_at: string | null };
type BusinessRow = { tenant_id: string; stripe_customer_id: string | null };

let tenants: TenantRow[] = [];
let businesses: BusinessRow[] = [];
let callLogs: Array<{ tenant_id: string; created_at: string; duration_seconds: number; outcome: string | null }> = [];
const tenantUpdates: Array<{ id: string; last_usage_reported_at: string }> = [];

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const state: { eqFilters: Record<string, unknown>; gte?: string; lt?: string; inIds?: string[]; notNull?: string } = { eqFilters: {} };
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, val: unknown) => { state.eqFilters[col] = val; return b; };
      b.gte = (_col: string, val: string) => { state.gte = val; return b; };
      b.lt = (_col: string, val: string) => { state.lt = val; return b; };
      b.in = (_col: string, vals: string[]) => { state.inIds = vals; return b; };
      b.not = (col: string) => { state.notNull = col; return b; };
      b.update = (patch: { last_usage_reported_at: string }) => {
        return {
          eq: (_col: string, id: string) => {
            tenantUpdates.push({ id, last_usage_reported_at: patch.last_usage_reported_at });
            const t = tenants.find((x) => x.id === id);
            if (t) t.last_usage_reported_at = patch.last_usage_reported_at;
            return Promise.resolve({ error: null });
          },
        };
      };
      const resolve = () => {
        if (table === 'calldesk_call_logs') {
          let rows = callLogs.filter((c) => c.tenant_id === state.eqFilters.tenant_id);
          if (state.gte) rows = rows.filter((c) => c.created_at >= (state.gte as string));
          if (state.lt) rows = rows.filter((c) => c.created_at < (state.lt as string));
          return { data: rows, error: null };
        }
        if (table === 'calldesk_businesses') {
          if (state.notNull) return { data: businesses.filter((x) => x.stripe_customer_id != null), error: null };
          return { data: businesses, error: null };
        }
        if (table === 'calldesk_tenants') {
          if (state.inIds) return { data: tenants.filter((t) => state.inIds!.includes(t.id)), error: null };
          return { data: tenants, error: null };
        }
        return { data: [], error: null };
      };
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(res, rej);
      return b;
    },
  }),
}));

type MeterEventPayload = { event_name: string; identifier: string; timestamp: number; payload: { stripe_customer_id: string; value: string } };
const meterEventsCreate = vi.fn(async (_args: MeterEventPayload) => ({ identifier: 'evt_1' }));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    billing: { meterEvents: { create: meterEventsCreate } },
  }),
}));

import { POST } from '@/app/api/admin/billing/report-usage/route';

function req() {
  return new Request('http://localhost/api/admin/billing/report-usage', {
    method: 'POST',
    headers: { authorization: 'Bearer test-cron-secret' },
  }) as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  tenants = [];
  businesses = [];
  callLogs = [];
  tenantUpdates.length = 0;
  meterEventsCreate.mockClear();
});

it('rejects unauthenticated requests', async () => {
  const res = await POST(new Request('http://localhost/api/admin/billing/report-usage', { method: 'POST' }) as unknown as import('next/server').NextRequest);
  expect(res.status).toBe(401);
});

it('reports usage for a tenant with new call seconds since last_usage_reported_at', async () => {
  tenants = [{ id: 't1', last_usage_reported_at: '2026-01-01T00:00:00.000Z' }];
  businesses = [{ tenant_id: 't1', stripe_customer_id: 'cus_1' }];
  callLogs = [{ tenant_id: 't1', created_at: '2026-01-02T00:00:00.000Z', duration_seconds: 600, outcome: null }]; // 600 seconds

  const body = await (await POST(req())).json();
  expect(body.results).toHaveLength(1);
  expect(body.results[0].status).toBe('reported');
  expect(body.results[0].recorded).toEqual([
    { dimension: 'voice', eventName: 'calldesktech_voice_seconds', value: 600, identifier: expect.stringMatching(/^ur:t1:voice:/) },
  ]);

  expect(meterEventsCreate).toHaveBeenCalledTimes(1);
  const [payload] = meterEventsCreate.mock.calls[0];
  expect(payload).toMatchObject({
    event_name: 'calldesktech_voice_seconds',
    payload: { stripe_customer_id: 'cus_1', value: '600' },
  });
  expect(payload.identifier).toMatch(/^ur:t1:voice:/);

  // last_usage_reported_at advanced so the same window isn't re-reported.
  expect(tenantUpdates).toHaveLength(1);
  expect(tenantUpdates[0].id).toBe('t1');
});

it('skips a tenant with zero new usage since its last report — no meter event created', async () => {
  tenants = [{ id: 't2', last_usage_reported_at: '2026-01-01T00:00:00.000Z' }];
  businesses = [{ tenant_id: 't2', stripe_customer_id: 'cus_2' }];
  callLogs = []; // nothing new

  const body = await (await POST(req())).json();
  expect(body.results[0].status).toBe('skipped_zero_usage');
  expect(meterEventsCreate).not.toHaveBeenCalled();
  expect(tenantUpdates).toHaveLength(0);
});

it('a tenant with no prior watermark only initializes the baseline — no backfill, no Stripe call', async () => {
  tenants = [{ id: 't4', last_usage_reported_at: null }];
  businesses = [{ tenant_id: 't4', stripe_customer_id: 'cus_4' }];
  // Months of pre-existing usage that must NOT be reported on this first run.
  callLogs = [{ tenant_id: 't4', created_at: '2025-01-01T00:00:00.000Z', duration_seconds: 6000, outcome: null }];

  const body = await (await POST(req())).json();
  expect(body.results[0].status).toBe('baseline_initialized');
  expect(meterEventsCreate).not.toHaveBeenCalled();
  expect(tenantUpdates).toHaveLength(1);
  expect(tenantUpdates[0].id).toBe('t4');

  // Next run (watermark now set) sees no *new* usage — the backlog stays unreported.
  const second = await (await POST(req())).json();
  expect(second.results[0].status).toBe('skipped_zero_usage');
  expect(meterEventsCreate).not.toHaveBeenCalled();
});

it('retrying the same run twice does not double-report: second call skips because last_usage_reported_at already advanced', async () => {
  tenants = [{ id: 't3', last_usage_reported_at: '2026-01-01T00:00:00.000Z' }];
  businesses = [{ tenant_id: 't3', stripe_customer_id: 'cus_3' }];
  callLogs = [{ tenant_id: 't3', created_at: '2026-01-02T00:00:00.000Z', duration_seconds: 300, outcome: null }];

  const first = await (await POST(req())).json();
  expect(first.results[0].status).toBe('reported');
  expect(meterEventsCreate).toHaveBeenCalledTimes(1);

  // Retry: last_usage_reported_at has moved past the call log's created_at,
  // so the window is now empty and nothing new is reported.
  const second = await (await POST(req())).json();
  expect(second.results[0].status).toBe('skipped_zero_usage');
  expect(meterEventsCreate).toHaveBeenCalledTimes(1); // still just once
});
