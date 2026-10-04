import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeResource: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/stripe', () => ({
  syncVoicePriceForTenant: vi.fn().mockResolvedValue(undefined),
  ensureTierItemForTenant: vi.fn().mockResolvedValue({ status: 'added', itemId: 'si_1' }),
  ensureExpertBackupItemForTenant: vi.fn().mockResolvedValue({ status: 'added', itemId: 'si_eb' }),
}));

import { getSupabaseAdmin } from '@/lib/supabase';
import { ensureTierItemForTenant, ensureExpertBackupItemForTenant } from '@/lib/stripe';
import { POST } from '@/app/api/agents/[id]/versions/route';

let inserted: Record<string, unknown> | null;
let insertError: { message: string; code?: string } | null;
let flowsInserted: number;

function supabaseMock() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      let op = '';
      for (const m of ['select', 'eq', 'order', 'limit', 'in']) b[m] = () => b;
      b.insert = (row: Record<string, unknown>) => {
        op = 'insert';
        if (table === 'calldesk_agent_versions') inserted = row;
        if (table === 'calldesk_conversation_flows') flowsInserted += 1;
        return b;
      };
      const result = () => {
        if (table === 'calldesk_agents') return { data: { tenant_id: 't1' }, error: null };
        if (table === 'calldesk_conversation_flows') return { data: { id: 'flow1' }, error: null };
        if (table === 'calldesk_agent_versions' && op === 'insert') return insertError ? { data: null, error: insertError } : { data: { id: 'v1', ...inserted }, error: null };
        return { data: null, error: null };
      };
      b.single = async () => result();
      b.maybeSingle = async () => result();
      return b;
    },
  };
}

const nodes = [{ id: 'greet', type: 'greeting', prompt: 'hi', edges: [] }];
function post(extra: Record<string, unknown>) {
  const req = new NextRequest('https://example.com/api/agents/a1/versions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowName: 'v1', startNodeId: 'greet', nodes, voiceEngine: 'poc', ...extra }),
  });
  return POST(req, { params: Promise.resolve({ id: 'a1' }) });
}
const eb = { tier: 'standard', routingMode: 'expert_backup', acceptExpertBackup: true };

beforeEach(() => {
  inserted = null; insertError = null; flowsInserted = 0;
  vi.mocked(getSupabaseAdmin).mockReturnValue(supabaseMock() as never);
  vi.mocked(ensureTierItemForTenant).mockReset().mockResolvedValue({ status: 'added', itemId: 'si_1' });
  vi.mocked(ensureExpertBackupItemForTenant).mockReset().mockResolvedValue({ status: 'added', itemId: 'si_eb' });
  process.env.STRIPE_TIER_STANDARD_PRICE = 'price_std';
  process.env.STRIPE_TIER_LITE_PRICE = 'price_lite';
  process.env.STRIPE_TIER_PRO_PRICE = 'price_pro';
  process.env.STRIPE_PRICE_EXPERT_BACKUP = 'price_eb';
});

it('publishes expert backup on standard: attaches the item first, stores routing_mode', async () => {
  const res = await post(eb);
  expect(res.status).toBe(201);
  expect(ensureExpertBackupItemForTenant).toHaveBeenCalledWith('t1');
  expect(inserted).toMatchObject({ tier: 'standard', routing_mode: 'expert_backup' });
});

it('publishes expert backup on lite (with the lite quality acceptance)', async () => {
  const res = await post({ ...eb, tier: 'lite', acceptLowerQuality: true });
  expect(res.status).toBe(201);
  expect(inserted).toMatchObject({ tier: 'lite', routing_mode: 'expert_backup' });
});

it('without routingMode (absent or null) nothing changes: no column written, no Stripe call', async () => {
  for (const extra of [{ tier: 'standard' }, { tier: 'standard', routingMode: null }, {}]) {
    inserted = null;
    const res = await post(extra);
    expect(res.status).toBe(201);
    expect(inserted).not.toHaveProperty('routing_mode');
  }
  expect(ensureExpertBackupItemForTenant).not.toHaveBeenCalled();
});

it('Pro is refused with a clear code, nothing saved', async () => {
  const res = await post({ ...eb, tier: 'pro' });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('expert_backup_tier_not_allowed');
  expect(inserted).toBeNull();
  expect(flowsInserted).toBe(0);
  expect(ensureExpertBackupItemForTenant).not.toHaveBeenCalled();
});

it('an untiered publish is refused', async () => {
  const res = await post({ routingMode: 'expert_backup', acceptExpertBackup: true });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('expert_backup_tier_not_allowed');
  expect(inserted).toBeNull();
});

it('retell is refused', async () => {
  const res = await post({ ...eb, voiceEngine: 'retell', tier: undefined });
  expect(res.status).toBe(400);
  expect(inserted).toBeNull();
});

it('a missing acceptExpertBackup is a 400 with the terms, nothing saved', async () => {
  const res = await post({ tier: 'standard', routingMode: 'expert_backup' });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('expert_backup_acceptance_required');
  expect(body.error).toMatch(/acceptExpertBackup/);
  expect(body.terms).toContain('1.5 cents per minute');
  expect(inserted).toBeNull();
  expect(ensureExpertBackupItemForTenant).not.toHaveBeenCalled();
});

it('an unknown routing mode is a 400', async () => {
  const res = await post({ tier: 'standard', routingMode: 'turbo', acceptExpertBackup: true });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('invalid_routing_mode');
});

it('fails closed with 503 when STRIPE_PRICE_EXPERT_BACKUP is unset or blank: no free expert backup', async () => {
  for (const v of [undefined, '  ']) {
    if (v === undefined) delete process.env.STRIPE_PRICE_EXPERT_BACKUP; else process.env.STRIPE_PRICE_EXPERT_BACKUP = v;
    const res = await post(eb);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('expert_backup_not_configured');
    expect(inserted).toBeNull();
    expect(flowsInserted).toBe(0);
    expect(ensureExpertBackupItemForTenant).not.toHaveBeenCalled();
  }
});

it('a Stripe failure is a retryable 502, nothing saved, and a retry succeeds', async () => {
  vi.mocked(ensureExpertBackupItemForTenant).mockRejectedValueOnce(new Error('stripe is down'));
  const failed = await post(eb);
  expect(failed.status).toBe(502);
  expect(await failed.json()).toMatchObject({ code: 'expert_backup_billing_failed', retryable: true });
  expect(inserted).toBeNull();
  expect(flowsInserted).toBe(0);
  const retry = await post(eb);
  expect(retry.status).toBe(201);
  expect(inserted).toMatchObject({ routing_mode: 'expert_backup' });
});

it('a tenant with no subscription still publishes', async () => {
  vi.mocked(ensureExpertBackupItemForTenant).mockResolvedValueOnce({ status: 'no_subscription' });
  expect((await post(eb)).status).toBe(201);
});

it('the tier line is attached before the expert backup line and both before any write', async () => {
  const order: string[] = [];
  vi.mocked(ensureTierItemForTenant).mockImplementation(async () => { order.push('tier'); return { status: 'added', itemId: 'a' }; });
  vi.mocked(ensureExpertBackupItemForTenant).mockImplementation(async () => { order.push('eb'); expect(flowsInserted).toBe(0); return { status: 'added', itemId: 'b' }; });
  await post(eb);
  expect(order).toEqual(['tier', 'eb']);
});

it('tolerates a database without the column: a plain publish is untouched, an expert backup publish gets a clear 503', async () => {
  insertError = { message: 'column "routing_mode" of relation "calldesk_agent_versions" does not exist', code: '42703' };
  const res = await post(eb);
  expect(res.status).toBe(503);
  expect((await res.json()).code).toBe('expert_backup_not_configured');
  insertError = null;
  expect((await post({ tier: 'standard' })).status).toBe(201);
});

it('publishing a version WITHOUT the mode never removes or touches the expert backup item (removal rule)', async () => {
  const res = await post({ tier: 'standard' });
  expect(res.status).toBe(201);
  expect(ensureExpertBackupItemForTenant).not.toHaveBeenCalled();
});
