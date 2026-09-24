import { describe, it, expect, vi, beforeEach } from 'vitest';

// The forms route is the only way a lead reaches the submission worker, so its
// validation is the enforcement point for "nothing without a human click".
const requireAdminSession = vi.fn(async () => ({ email: 'admin@calldesk.tech' }) as { email: string } | null);
vi.mock('@/lib/outreach/adminAuth', () => ({ requireAdminSession: () => requireAdminSession() }));

let leadRow: Record<string, unknown> | null = null;
const updates: Record<string, unknown>[] = [];
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, like: chain, not: chain, order: chain, limit: chain,
        maybeSingle: async () => ({ data: leadRow, error: null }),
        then: undefined,
        update: (v: Record<string, unknown>) => { updates.push(v); return { eq: async () => ({ error: null }) }; },
      });
      return q;
    },
  }),
}));

import { PATCH } from '@/app/api/admin/outreach/forms/route';

const ID = '11111111-1111-4111-8111-111111111111';
const req = (body: unknown) =>
  new Request('http://localhost/api/admin/outreach/forms', { method: 'PATCH', body: JSON.stringify(body) }) as never;

const withStatus = (status: string, extra: Record<string, unknown> = {}) => {
  leadRow = { id: ID, signals: { contactForm: { pageUrl: 'https://x.com/contact' }, formOutreach: { subject: 'S', body: 'B', status, ...extra } } };
};

const patched = () => (updates.at(-1)!.signals as { formOutreach: Record<string, unknown> }).formOutreach;

beforeEach(() => {
  updates.length = 0;
  requireAdminSession.mockResolvedValue({ email: 'admin@calldesk.tech' });
  withStatus('ready');
});

describe('forms PATCH validation', () => {
  it('requires an admin session', async () => {
    requireAdminSession.mockResolvedValue(null);
    expect((await PATCH(req({ id: ID, action: 'queue' }))).status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('rejects a missing id, an unknown status and an unknown action', async () => {
    expect((await PATCH(req({ status: 'submitted' }))).status).toBe(400);
    expect((await PATCH(req({ id: ID, status: 'nonsense' }))).status).toBe(400);
    expect((await PATCH(req({ id: ID, action: 'solve_captcha' }))).status).toBe(400);
    expect((await PATCH(req({ id: ID }))).status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it('404s when the lead has no form draft', async () => {
    leadRow = null;
    expect((await PATCH(req({ id: ID, action: 'queue' }))).status).toBe(404);
    leadRow = { id: ID, signals: {} };
    expect((await PATCH(req({ id: ID, action: 'queue' }))).status).toBe(404);
  });
});

describe('the queue action is the human click', () => {
  it('moves ready -> queued and records who queued it', async () => {
    const res = await PATCH(req({ id: ID, action: 'queue' }));
    expect(res.status).toBe(200);
    expect(patched()).toMatchObject({ status: 'queued', queuedBy: 'admin@calldesk.tech' });
    expect(patched().queuedAt).toBeTruthy();
  });

  it('re-queues a needs_manual lead and clears the stale reason', async () => {
    withStatus('needs_manual', { reason: 'unconfirmed' });
    expect((await PATCH(req({ id: ID, action: 'queue' }))).status).toBe(200);
    expect(patched().status).toBe('queued');
    expect(patched().reason).toBeUndefined();
  });

  it('retries only from failed / needs_manual', async () => {
    withStatus('failed', { error: 'timeout' });
    expect((await PATCH(req({ id: ID, action: 'retry' }))).status).toBe(200);
    expect(patched()).toMatchObject({ status: 'queued' });
    expect(patched().error).toBeUndefined();

    withStatus('ready');
    expect((await PATCH(req({ id: ID, action: 'retry' }))).status).toBe(409);
  });

  it('refuses to queue a lead that is already submitted, queued or in flight', async () => {
    for (const status of ['submitted', 'queued', 'submitting', 'skipped', 'replied']) {
      withStatus(status);
      const res = await PATCH(req({ id: ID, action: 'queue' }));
      expect(res.status, status).toBe(409);
    }
    expect(updates).toHaveLength(0);
  });
});

describe('manual marks', () => {
  it('lets a human mark submitted and stamps submittedAt', async () => {
    expect((await PATCH(req({ id: ID, status: 'submitted' }))).status).toBe(200);
    expect(patched().submittedAt).toBeTruthy();
  });

  it('marks replied and stops further outreach on the lead', async () => {
    withStatus('submitted');
    expect((await PATCH(req({ id: ID, status: 'replied' }))).status).toBe(200);
    expect(updates.at(-1)!.replied_at).toBeTruthy();
  });

  it('will not re-open a submitted lead or set a worker-only status by hand', async () => {
    withStatus('submitted');
    expect((await PATCH(req({ id: ID, status: 'ready' }))).status).toBe(409);
    withStatus('ready');
    expect((await PATCH(req({ id: ID, status: 'queued' }))).status).toBe(409);
    expect((await PATCH(req({ id: ID, status: 'submitting' }))).status).toBe(409);
    expect((await PATCH(req({ id: ID, status: 'failed' }))).status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('will not change a lead the worker has in flight', async () => {
    withStatus('submitting');
    expect((await PATCH(req({ id: ID, status: 'skipped' }))).status).toBe(409);
  });
});
