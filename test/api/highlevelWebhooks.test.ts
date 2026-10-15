import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const verify = vi.fn();
const handle = vi.fn();
vi.mock('@/lib/highlevel/webhookSignature', () => ({ GHL_SIGNATURE_HEADER: 'x-ghl-signature', verifyGhlSignature: (...a: unknown[]) => verify(...a) }));
vi.mock('@/lib/highlevel/appWebhooks', () => ({ handleAppWebhook: (...a: unknown[]) => handle(...a) }));
import { POST } from '@/app/api/highlevel/webhooks/route';

const post = (body: string, headers: Record<string, string> = { 'x-ghl-signature': 'sig' }) =>
  POST(new NextRequest('https://calldesk.tech/api/highlevel/webhooks', { method: 'POST', headers, body }));
const BODY = JSON.stringify({ type: 'UNINSTALL', locationId: 'loc_1' });

beforeEach(() => { vi.clearAllMocks(); verify.mockReturnValue(true); handle.mockResolvedValue('uninstalled_location'); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('POST /api/highlevel/webhooks', () => {
  it('verifies the signature over the raw body, then handles the event', async () => {
    const r = await post(BODY);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, handled: 'uninstalled_location' });
    expect(verify).toHaveBeenCalledWith(BODY, 'sig');
    expect(handle).toHaveBeenCalledWith({ type: 'UNINSTALL', locationId: 'loc_1' });
  });
  it('logs the event type and the outcome, and nothing from the body', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await post(JSON.stringify({ type: 'UNINSTALL', locationId: 'loc_SECRET_ID', userId: 'u_1' }));
    expect(info).toHaveBeenCalledWith('[highlevel] webhook', 'UNINSTALL', 'uninstalled_location');
    expect(JSON.stringify(info.mock.calls)).not.toContain('loc_SECRET_ID');
    info.mockRestore();
  });
  it('401 and nothing handled when the signature is wrong or missing', async () => {
    verify.mockReturnValue(false);
    expect((await post(BODY)).status).toBe(401);
    expect((await post(BODY, {})).status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });
  it('400 for a signed body that is not a JSON object', async () => {
    for (const b of ['nope', '[]', '"x"', 'null']) expect((await post(b)).status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });
  it('200 for an event we ignore, so HighLevel does not retry it', async () => {
    handle.mockResolvedValue('ignored');
    const r = await post(JSON.stringify({ type: 'INSTALL' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ handled: 'ignored' });
  });
  it('500 when handling fails, so HighLevel retries', async () => {
    handle.mockRejectedValue(new Error('db down'));
    expect((await post(BODY)).status).toBe(500);
  });
});
