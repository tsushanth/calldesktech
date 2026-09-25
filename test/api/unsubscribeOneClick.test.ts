import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn(async (..._a: unknown[]) => ({ error: null }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: () => ({ upsert }) }) }));

import { POST } from '@/app/api/unsubscribe/[token]/route';
import UnsubscribePage from '@/app/unsubscribe/[token]/page';
import { makeUnsubscribeToken, oneClickUnsubscribeUrl } from '@/lib/outreach/unsubscribe';

beforeEach(() => {
  upsert.mockClear();
  process.env.UNSUBSCRIBE_SECRET = 'test-secret';
});

const req = (accept = 'application/json') =>
  new Request('https://calldesk.tech/api/unsubscribe/x', { method: 'POST', headers: { accept } }) as never;

describe('one-click unsubscribe', () => {
  it('POST with a valid token suppresses that address', async () => {
    const token = makeUnsubscribeToken('Lead@Example.com');
    const res = await POST(req(), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ email: 'lead@example.com', reason: 'unsubscribed via link' }, { onConflict: 'email' });
  });

  it('POST with a tampered token changes nothing', async () => {
    const res = await POST(req(), { params: Promise.resolve({ token: `${makeUnsubscribeToken('a@b.co')}x` }) });
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('a browser form post redirects to the done page', async () => {
    const token = makeUnsubscribeToken('a@b.co');
    const res = await POST(req('text/html'), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain(`/unsubscribe/${token}?done=1`);
  });

  it('loading the page (what link scanners do) never suppresses anyone', async () => {
    const token = makeUnsubscribeToken('a@b.co');
    await UnsubscribePage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('header URL targets the POST endpoint', () => {
    expect(oneClickUnsubscribeUrl('a@b.co')).toContain('/api/unsubscribe/');
  });
});
