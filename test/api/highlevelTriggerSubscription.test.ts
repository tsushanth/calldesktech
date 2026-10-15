import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getInstall = vi.fn();
const applySubscription = vi.fn();
vi.mock('@/lib/highlevel/installs', () => ({ getInstall: (...a: unknown[]) => getInstall(...a) }));
vi.mock('@/lib/highlevel/triggers', () => ({ applySubscription: (...a: unknown[]) => applySubscription(...a) }));
import { POST } from '@/app/api/highlevel/triggers/subscription/route';

const SECRET = 'a-long-shared-secret-123';
const post = (body: unknown, opts: { headers?: Record<string, string>; qs?: string } = {}) =>
  POST(new NextRequest(`https://calldesk.tech/api/highlevel/triggers/subscription${opts.qs ?? ''}`, { method: 'POST', headers: opts.headers ?? { 'x-calldesk-secret': SECRET }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const evt = { triggerData: { id: 't1', key: 'call_completed', eventType: 'CREATED', targetUrl: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/t1' }, extras: { locationId: 'loc_1' } };

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('HIGHLEVEL_APP_SECRET', SECRET);
  getInstall.mockResolvedValue({ status: 'active', tenant_id: 'tenant_1' });
  applySubscription.mockResolvedValue({ ok: true });
});

describe('POST /api/highlevel/triggers/subscription', () => {
  it('applies the subscription for the workspace linked to the location', async () => {
    const r = await post(evt);
    expect(r.status).toBe(200);
    expect(applySubscription).toHaveBeenCalledWith(evt, 'tenant_1', 'loc_1');
  });
  it('accepts the secret in the URL as well as the header', async () => {
    expect((await post(evt, { headers: {}, qs: `?k=${SECRET}` })).status).toBe(200);
  });
  it('401 without the secret, and nothing is looked up or changed', async () => {
    expect((await post(evt, { headers: {} })).status).toBe(401);
    expect((await post(evt, { headers: { 'x-calldesk-secret': 'wrong-secret-of-same-len' } })).status).toBe(401);
    expect(getInstall).not.toHaveBeenCalled();
    expect(applySubscription).not.toHaveBeenCalled();
  });
  it('400 for bad JSON or a missing location; 404 not installed; 409 not linked', async () => {
    expect((await post('nope')).status).toBe(400);
    expect((await post({ triggerData: {}, extras: {} })).status).toBe(400);
    getInstall.mockResolvedValue(null);
    expect((await post(evt)).status).toBe(404);
    getInstall.mockResolvedValue({ status: 'uninstalled', tenant_id: 'tenant_1' });
    expect((await post(evt)).status).toBe(404);
    getInstall.mockResolvedValue({ status: 'active', tenant_id: null });
    expect((await post(evt)).status).toBe(409);
    expect(applySubscription).not.toHaveBeenCalled();
  });
  it('passes the reason when the subscription is refused', async () => {
    applySubscription.mockResolvedValue({ ok: false, status: 400, error: 'targetUrl is not a HighLevel trigger execute URL for this account' });
    const r = await post(evt);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'targetUrl is not a HighLevel trigger execute URL for this account' });
  });
});
