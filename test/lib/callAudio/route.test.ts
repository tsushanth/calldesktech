import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireTenantRole = vi.fn();
const authorizeTenant = vi.fn();
const createCallAudioAsset = vi.fn();
vi.mock('@/lib/authz', () => ({ requireTenantRole: (...a: unknown[]) => requireTenantRole(...a), authorizeTenant: (...a: unknown[]) => authorizeTenant(...a) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'a1', name: 'chime' }], error: null }) }) }) }) }) }));
vi.mock('@/lib/callAudio/assets', async (orig) => ({ ...(await orig<typeof import('@/lib/callAudio/assets')>()), createCallAudioAsset: (...a: unknown[]) => createCallAudioAsset(...a) }));

const { POST, GET } = await import('@/app/api/tenants/[id]/call-audio/route');

const ctx = { params: Promise.resolve({ id: 'tenant-1' }) };
const req = (body?: unknown) => new NextRequest('http://x/api/tenants/tenant-1/call-audio', { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
const denied = (status: number) => ({ ok: false, response: NextResponse.json({ error: 'nope' }, { status }) });
const goodBody = { type: 'sound_effect', name: 'chime', description: 'after booking', prompt: 'a chime', durationSec: 2 };

beforeEach(() => { vi.clearAllMocks(); process.env.READALOUD_API_KEY = 'k'; });

describe('POST /api/tenants/[id]/call-audio', () => {
  it('requires owner/admin, session only (no API keys) — and never generates for a denied caller', async () => {
    requireTenantRole.mockResolvedValue(denied(404));
    const res = await POST(req(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(requireTenantRole).toHaveBeenCalledWith(expect.anything(), 'tenant-1', ['owner', 'admin'], { apiKeysAllowed: false });
    expect(createCallAudioAsset).not.toHaveBeenCalled();
  });
  it('creates the asset for an authorized caller and returns 201 with the row (no audio bytes)', async () => {
    requireTenantRole.mockResolvedValue({ ok: true, tenantId: 'tenant-1' });
    createCallAudioAsset.mockResolvedValue({ id: 'n1', name: 'chime', enabled: true });
    const res = await POST(req(goodBody), ctx);
    expect(res.status).toBe(201);
    expect((await res.json()).asset).toMatchObject({ id: 'n1' });
    expect(createCallAudioAsset).toHaveBeenCalledWith({ tenantId: 'tenant-1', type: 'sound_effect', name: 'chime', description: 'after booking', prompt: 'a chime', durationSec: 2 }, expect.anything());
  });
  it('rejects a malformed body with 400 before generating', async () => {
    requireTenantRole.mockResolvedValue({ ok: true, tenantId: 'tenant-1' });
    for (const bad of [{ ...goodBody, prompt: undefined }, { ...goodBody, durationSec: 'long' }, { ...goodBody, type: undefined }]) {
      const res = await POST(req(bad), ctx);
      expect(res.status).toBe(400);
    }
    expect(createCallAudioAsset).not.toHaveBeenCalled();
  });
  it('maps pipeline errors to their HTTP status', async () => {
    requireTenantRole.mockResolvedValue({ ok: true, tenantId: 'tenant-1' });
    const { ReadAloudError } = await import('@/lib/callAudio/readaloudClient');
    createCallAudioAsset.mockRejectedValue(new ReadAloudError('payment_required', 'needs subscription'));
    expect((await POST(req(goodBody), ctx)).status).toBe(402);
  });
});

describe('GET /api/tenants/[id]/call-audio', () => {
  it('any authorized tenant member can list; unauthorized gets the auth response', async () => {
    authorizeTenant.mockResolvedValueOnce(denied(401));
    expect((await GET(req(), ctx)).status).toBe(401);
    authorizeTenant.mockResolvedValueOnce({ ok: true, tenantId: 'tenant-1' });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).assets).toEqual([{ id: 'a1', name: 'chime' }]);
  });
});
