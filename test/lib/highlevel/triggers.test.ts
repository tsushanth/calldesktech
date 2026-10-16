import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { calldesk_webhooks: [], calldesk_highlevel_trigger_subscriptions: [] };
let nextId = 1;
let failInsertOn: string | null = null;

function from(name: string) {
  const state = { op: 'select', patch: {} as Row, eq: {} as Record<string, unknown>, row: null as Row | null };
  const hit = () => tables[name].filter((r) => Object.entries(state.eq).every(([k, v]) => r[k] === v));
  const exec = () => {
    if (state.op === 'update') { hit().forEach((r) => Object.assign(r, state.patch)); return { data: null, error: null }; }
    if (state.op === 'delete') { tables[name] = tables[name].filter((r) => !hit().includes(r)); return { data: null, error: null }; }
    if (state.op === 'insert') {
      if (failInsertOn === name) return { data: null, error: { message: 'boom' } };
      const row = { id: `id${nextId++}`, ...state.row }; tables[name].push(row); return { data: { id: row.id }, error: null };
    }
    return { data: hit().map((r) => ({ ...r })), error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (row: Row) => { state.op = 'insert'; state.row = row; return b; },
    upsert: async (row: Row) => {
      if (failInsertOn === name) return { error: { message: 'boom' } };
      const i = tables[name].findIndex((r) => r.location_id === row.location_id && r.hl_trigger_id === row.hl_trigger_id);
      if (i >= 0) Object.assign(tables[name][i], row); else tables[name].push({ id: `id${nextId++}`, ...row });
      return { error: null };
    },
    update: (patch: Row) => { state.op = 'update'; state.patch = patch; return b; },
    delete: () => { state.op = 'delete'; return b; },
    eq: (k: string, v: unknown) => { state.eq[k] = v; return b; },
    maybeSingle: async () => { const r = exec(); const d = r.data as Row[] | null; return { data: d?.[0] ?? null, error: null }; },
    single: async () => exec(),
    then: (res: (v: unknown) => unknown) => res(exec()),
  };
  return b;
}
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from }) }));
import { applySubscription, removeSubscriptionsForLocation, moveSubscriptionsToTenant, validateTargetUrl } from '@/lib/highlevel/triggers';

const LOC = 'loc_1';
const URL1 = `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/${LOC}/trig_9`;
const evt = (over: Record<string, unknown> = {}, extras: Record<string, unknown> = {}) => ({
  triggerData: { id: 'trig_9', key: 'call_completed', eventType: 'CREATED', targetUrl: URL1, ...over },
  extras: { locationId: LOC, companyId: 'co_1', workflowId: 'wf_1', ...extras },
});
beforeEach(() => { tables.calldesk_webhooks = []; tables.calldesk_highlevel_trigger_subscriptions = []; nextId = 1; failInsertOn = null; });

describe('validateTargetUrl', () => {
  it('accepts a HighLevel trigger execute URL for this sub-account or its company', () => {
    expect(validateTargetUrl(URL1, [LOC])).toBe(URL1);
    expect(validateTargetUrl(`https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/co_1/t`, [LOC, 'co_1'])).toContain('/co_1/t');
  });
  it('refuses anything else', () => {
    const bad = [
      `http://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/${LOC}/t`,
      `https://evil.example.com/workflows-marketplace/triggers/execute/${LOC}/t`,
      `https://services.leadconnectorhq.com.evil.com/workflows-marketplace/triggers/execute/${LOC}/t`,
      `https://user:pw@services.leadconnectorhq.com/workflows-marketplace/triggers/execute/${LOC}/t`,
      `https://services.leadconnectorhq.com:8443/workflows-marketplace/triggers/execute/${LOC}/t`,
      `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/${LOC}/t?x=1`,
      `https://services.leadconnectorhq.com/other/path/${LOC}/t`,
      `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/someone_else/t`,
      `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/${LOC}`,
      `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/${LOC}/t/extra`,
      'not a url', '', null, undefined, 42,
    ];
    for (const u of bad) expect(validateTargetUrl(u, [LOC])).toBeNull();
  });
});

describe('applySubscription', () => {
  it('CREATED makes a flat call.completed webhook for the workspace pointing at HighLevel, and a subscription that owns it', async () => {
    expect(await applySubscription(evt(), 'tenant_1', LOC)).toEqual({ ok: true });
    const [wh] = tables.calldesk_webhooks;
    expect(wh).toMatchObject({ tenant_id: 'tenant_1', url: URL1, events: ['call.completed'], format: 'flat', enabled: true });
    expect(String(wh.secret)).toMatch(/^whsec_/);
    expect(tables.calldesk_highlevel_trigger_subscriptions[0]).toMatchObject({ location_id: LOC, hl_trigger_id: 'trig_9', target_url: URL1, webhook_id: wh.id });
  });
  it('CREATED twice does not create a second webhook', async () => {
    await applySubscription(evt(), 'tenant_1', LOC);
    await applySubscription(evt(), 'tenant_1', LOC);
    expect(tables.calldesk_webhooks).toHaveLength(1);
    expect(tables.calldesk_highlevel_trigger_subscriptions).toHaveLength(1);
  });
  it('UPDATED changes the URL on the same webhook', async () => {
    await applySubscription(evt(), 'tenant_1', LOC);
    const next = `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/${LOC}/trig_new`;
    await applySubscription(evt({ eventType: 'UPDATED', targetUrl: next }), 'tenant_1', LOC);
    expect(tables.calldesk_webhooks).toHaveLength(1);
    expect(tables.calldesk_webhooks[0].url).toBe(next);
    expect(tables.calldesk_highlevel_trigger_subscriptions[0].target_url).toBe(next);
  });
  it('DELETED removes the webhook and the subscription, and nothing else', async () => {
    tables.calldesk_webhooks.push({ id: 'other', tenant_id: 'tenant_1', url: 'https://example.com/hook' });
    await applySubscription(evt(), 'tenant_1', LOC);
    await applySubscription(evt({ eventType: 'DELETED' }), 'tenant_1', LOC);
    expect(tables.calldesk_webhooks.map((w) => w.id)).toEqual(['other']);
    expect(tables.calldesk_highlevel_trigger_subscriptions).toHaveLength(0);
  });
  it('DELETED will not remove another workspace\'s webhook', async () => {
    await applySubscription(evt(), 'tenant_1', LOC);
    await applySubscription(evt({ eventType: 'DELETED' }), 'tenant_OTHER', LOC);
    expect(tables.calldesk_webhooks).toHaveLength(1);
  });
  it('accepts the prefixed trigger key as the same trigger (HighLevel trigger keys are unique across apps)', async () => {
    expect(await applySubscription(evt({ key: 'calldesk_call_completed' }), 'tenant_1', LOC)).toMatchObject({ ok: true });
  });
  it('rejects a URL that is not for this account, an unknown key or event, and a missing id', async () => {
    expect(await applySubscription(evt({ targetUrl: 'https://evil.example.com/x' }), 'tenant_1', LOC)).toMatchObject({ ok: false, status: 400 });
    expect(await applySubscription(evt({}, { companyId: undefined, locationId: LOC }), 'tenant_1', 'someone_else')).toMatchObject({ ok: false, status: 400 });
    expect(await applySubscription(evt({ key: 'other' }), 'tenant_1', LOC)).toMatchObject({ ok: false, status: 400 });
    expect(await applySubscription(evt({ eventType: 'WHATEVER' }), 'tenant_1', LOC)).toMatchObject({ ok: false, status: 400 });
    expect(await applySubscription(evt({ id: '' }), 'tenant_1', LOC)).toMatchObject({ ok: false, status: 400 });
    expect(tables.calldesk_webhooks).toHaveLength(0);
  });
  it('removes the webhook again if saving the subscription fails, so nothing is left delivering', async () => {
    failInsertOn = 'calldesk_highlevel_trigger_subscriptions';
    expect(await applySubscription(evt(), 'tenant_1', LOC)).toMatchObject({ ok: false, status: 500 });
    expect(tables.calldesk_webhooks).toHaveLength(0);
  });
});

describe('removeSubscriptionsForLocation and moveSubscriptionsToTenant', () => {
  it('uninstall removes every HighLevel webhook for the sub-account only', async () => {
    await applySubscription(evt(), 'tenant_1', LOC);
    await applySubscription(evt({ id: 'trig_2', targetUrl: `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/${LOC}/trig_2` }), 'tenant_1', LOC);
    tables.calldesk_webhooks.push({ id: 'keep', tenant_id: 'tenant_1', url: 'https://example.com/hook' });
    await removeSubscriptionsForLocation(LOC);
    expect(tables.calldesk_webhooks.map((w) => w.id)).toEqual(['keep']);
    expect(tables.calldesk_highlevel_trigger_subscriptions).toHaveLength(0);
  });
  it('relinking to another workspace moves the webhooks with it', async () => {
    await applySubscription(evt(), 'tenant_1', LOC);
    await moveSubscriptionsToTenant(LOC, 'tenant_2');
    expect(tables.calldesk_webhooks[0].tenant_id).toBe('tenant_2');
  });
});
