import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn(async (_a: unknown) => ({ ok: true, id: 'r1' }));
vi.mock('@/lib/email', () => ({ sendEmail: (a: unknown) => sendEmail(a) }));
vi.mock('@/lib/outreach/mxCheck', () => ({ domainCanReceiveMail: async () => true }));
const verifyLeadEmail = vi.fn();
vi.mock('@/lib/outreach/emailVerify', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/emailVerify')>()), verifyLeadEmail: (...a: unknown[]) => verifyLeadEmail(...a) }));

import { sendApprovedMessage } from '@/lib/outreach/sender';

const MSG_ID = '22222222-2222-4222-8222-222222222222';
function fake() {
  const updates: { table: string; v: unknown }[] = []; const upserts: unknown[] = [];
  const client = {
    from(table: string) {
      const q = {
        select: () => q, eq: () => q, gte: () => q, not: () => q, like: () => q, or: () => q,
        then: (res: (v: unknown) => unknown) => res({ count: 0 }),
        maybeSingle: async () => table === 'calldesk_outreach_messages'
          ? { data: { id: MSG_ID, status: 'approved', product: 'calldesk:freight', lead_id: 'l1', to_email: 'Info@Dead.co', subject: 'S', body_text: 'Hi' }, error: null }
          : table === 'calldesk_outreach_leads' ? { data: { id: 'l1', region_blocked: false, signals: {} }, error: null } : { data: null, error: null },
        update: (v: unknown) => { updates.push({ table, v }); return { eq: async () => ({ error: null }) }; },
        upsert: async (v: unknown) => { upserts.push(v); return { error: null }; },
      };
      return q;
    },
  };
  return { client: client as never, updates, upserts };
}

beforeEach(() => {
  sendEmail.mockClear(); verifyLeadEmail.mockReset();
  process.env.OUTREACH_FROM_EMAIL = 'x@outreach.calldesk.tech'; process.env.OUTREACH_POSTAL_ADDRESS = '1 Main St'; process.env.UNSUBSCRIBE_SECRET = 's';
  delete process.env.OUTREACH_DAILY_CAP;
});

describe('sendApprovedMessage mailbox verification', () => {
  it('does not send to an undeliverable mailbox, marks it failed and suppresses the address', async () => {
    verifyLeadEmail.mockResolvedValue({ verdict: 'undeliverable', provider: 'millionverifier', detail: 'mailbox_not_found' });
    const f = fake();
    const r = await sendApprovedMessage(f.client, MSG_ID);
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(f.updates.some((u) => (u.v as { status?: string }).status === 'failed')).toBe(true);
    expect(f.upserts[0]).toMatchObject({ email: 'info@dead.co' });
  });
  it('sends when deliverable, when catch-all, and when verification is unknown or skipped', async () => {
    for (const verdict of ['deliverable', 'risky', 'unknown', 'skipped']) {
      sendEmail.mockClear(); verifyLeadEmail.mockResolvedValue({ verdict, provider: 'p' });
      const r = await sendApprovedMessage(fake().client, MSG_ID);
      expect(r.ok, verdict).toBe(true);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    }
  });
});
