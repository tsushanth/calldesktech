import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const getInstall = vi.fn();
const resolveFromNumber = vi.fn();
const placePhoneNumberCall = vi.fn();
const tryAcquireToken = vi.fn();
vi.mock('@/lib/highlevel/installs', () => ({ getInstall: (...a: unknown[]) => getInstall(...a) }));
vi.mock('@/lib/highlevel/numbers', () => ({ resolveFromNumber: (...a: unknown[]) => resolveFromNumber(...a) }));
vi.mock('@/lib/placeCall', () => ({ placePhoneNumberCall: (...a: unknown[]) => placePhoneNumberCall(...a) }));
vi.mock('@/lib/rateLimiter', () => ({ tryAcquireToken: (...a: unknown[]) => tryAcquireToken(...a), TWILIO_TENANT: { capacity: 1 } }));
import { POST } from '@/app/api/highlevel/actions/place-call/route';

const SECRET = 'a-long-shared-secret-123';
const call = (body: unknown, headers: Record<string, string> = { 'x-calldesk-secret': SECRET }) =>
  POST(new NextRequest('https://calldesk.tech/api/highlevel/actions/place-call', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const payload = (data: Record<string, unknown> = {}, locationId: unknown = 'loc_1') => ({ data: { phone: '(415) 555-0123', ...data }, extras: { locationId, contactId: 'c1', workflowId: 'w1' }, meta: { key: 'place_call', version: '1.0' } });
const json = async (r: Response) => r.json();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('HIGHLEVEL_APP_SECRET', SECRET);
  getInstall.mockResolvedValue({ location_id: 'loc_1', status: 'active', tenant_id: 'tenant_1' });
  resolveFromNumber.mockResolvedValue({ ok: true, phoneNumberId: 'pn_1' });
  tryAcquireToken.mockResolvedValue(true);
  placePhoneNumberCall.mockResolvedValue(NextResponse.json({ call: { sid: 'CA123' } }, { status: 201 }));
});

describe('POST /api/highlevel/actions/place-call', () => {
  it('places the call for the workspace linked to the location and returns the call sid', async () => {
    const r = await call(payload({ variables: 'first_name=Sam\ncompany=Acme' }));
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ success: true, call_sid: 'CA123', to: '+14155550123', error: '' });
    expect(getInstall).toHaveBeenCalledWith('loc_1');
    expect(resolveFromNumber).toHaveBeenCalledWith('tenant_1', undefined);
    expect(placePhoneNumberCall).toHaveBeenCalledWith('pn_1', '+14155550123', { first_name: 'Sam', company: 'Acme' }, { tenantId: 'tenant_1' });
    expect(tryAcquireToken).toHaveBeenCalledWith('twilio-tenant-tenant_1', expect.anything());
  });
  it('passes the "Call from" number through', async () => {
    await call(payload({ call_from: '+14155550101' }));
    expect(resolveFromNumber).toHaveBeenCalledWith('tenant_1', '+14155550101');
  });
  it('requires the app secret before doing anything', async () => {
    expect((await call(payload(), {})).status).toBe(401);
    expect((await call(payload(), { 'x-calldesk-secret': 'wrong-secret-of-same-len' })).status).toBe(401);
    expect(getInstall).not.toHaveBeenCalled();
    expect(placePhoneNumberCall).not.toHaveBeenCalled();
  });
  it('takes the workspace from the install, never from the body', async () => {
    await call({ ...payload(), tenant_id: 'attacker-tenant', data: { phone: '4155550123', tenantId: 'attacker-tenant' } });
    expect(resolveFromNumber).toHaveBeenCalledWith('tenant_1', undefined);
    expect(placePhoneNumberCall.mock.calls[0][3]).toEqual({ tenantId: 'tenant_1' });
  });
  it('400 for a body that is not JSON or has no location', async () => {
    expect((await call('not json')).status).toBe(400);
    expect((await call(payload({}, ''))).status).toBe(400);
    expect((await call({ data: { phone: '4155550123' } })).status).toBe(400);
  });
  it('explains an uninstalled, needs_reauth or unlinked sub-account as a failed action, not a crash', async () => {
    getInstall.mockResolvedValue(null);
    expect(await json(await call(payload()))).toMatchObject({ success: false, error: expect.stringContaining('not installed') });
    getInstall.mockResolvedValue({ status: 'needs_reauth', tenant_id: 'tenant_1' });
    expect(await json(await call(payload()))).toMatchObject({ success: false, error: expect.stringContaining('not installed') });
    getInstall.mockResolvedValue({ status: 'active', tenant_id: null });
    expect(await json(await call(payload()))).toMatchObject({ success: false, error: expect.stringContaining('not linked') });
    expect(placePhoneNumberCall).not.toHaveBeenCalled();
  });
  it('reports an unusable phone number or bad variables without placing a call', async () => {
    expect(await json(await call(payload({ phone: '0412345678' })))).toMatchObject({ success: false, error: expect.stringContaining('usable phone') });
    expect(await json(await call(payload({ phone: '' })))).toMatchObject({ success: false });
    expect(await json(await call(payload({ variables: 'no equals sign' })))).toMatchObject({ success: false, error: expect.stringContaining('name=value') });
    expect(placePhoneNumberCall).not.toHaveBeenCalled();
  });
  it('reports a workspace with no outbound number', async () => {
    resolveFromNumber.mockResolvedValue({ ok: false, error: 'no outbound number' });
    expect(await json(await call(payload()))).toMatchObject({ success: false, error: 'no outbound number' });
    expect(placePhoneNumberCall).not.toHaveBeenCalled();
  });
  it('429 when the workspace is placing calls too fast', async () => {
    tryAcquireToken.mockResolvedValue(false);
    expect((await call(payload())).status).toBe(429);
    expect(placePhoneNumberCall).not.toHaveBeenCalled();
  });
  it('turns a refused call (pilot block, engine error) into a failed action with the reason', async () => {
    placePhoneNumberCall.mockResolvedValue(NextResponse.json({ error: 'Twilio: not a valid mobile number' }, { status: 400 }));
    expect(await json(await call(payload()))).toEqual({ success: false, call_sid: '', to: '', error: 'Twilio: not a valid mobile number' });
    placePhoneNumberCall.mockResolvedValue(new NextResponse('boom', { status: 502 }));
    expect(await json(await call(payload()))).toMatchObject({ success: false, error: expect.stringContaining('502') });
  });
  it('accepts the other call id field names the engine might return', async () => {
    placePhoneNumberCall.mockResolvedValue(NextResponse.json({ call: { callSid: 'CA999' } }, { status: 201 }));
    expect(await json(await call(payload()))).toMatchObject({ success: true, call_sid: 'CA999' });
  });
});
