import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyMailbox, verifyLeadEmail, shouldBlock, mapMillionVerifier, mapZeroBounce } from '@/lib/outreach/emailVerify';

const json = (o: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => o })) as unknown as typeof fetch;

describe('provider mappings', () => {
  it('millionverifier', () => {
    expect(mapMillionVerifier({ result: 'ok' }).verdict).toBe('deliverable');
    expect(mapMillionVerifier({ result: 'invalid', subresult: 'mailbox_not_found' })).toMatchObject({ verdict: 'undeliverable', detail: 'mailbox_not_found' });
    expect(mapMillionVerifier({ result: 'disposable' }).verdict).toBe('undeliverable');
    expect(mapMillionVerifier({ result: 'catch_all' }).verdict).toBe('risky');
    expect(mapMillionVerifier({ result: 'unknown' }).verdict).toBe('unknown');
    expect(mapMillionVerifier({ error: 'insufficient credits', result: '' }).verdict).toBe('unknown');
  });
  it('zerobounce: role-based do_not_mail is NOT treated as undeliverable (info@ is our main target)', () => {
    expect(mapZeroBounce({ status: 'valid' }).verdict).toBe('deliverable');
    expect(mapZeroBounce({ status: 'invalid' }).verdict).toBe('undeliverable');
    expect(mapZeroBounce({ status: 'spamtrap' }).verdict).toBe('undeliverable');
    expect(mapZeroBounce({ status: 'do_not_mail', sub_status: 'role_based' }).verdict).toBe('risky');
    expect(mapZeroBounce({ status: 'do_not_mail', sub_status: 'disposable' }).verdict).toBe('undeliverable');
    expect(mapZeroBounce({ status: 'catch-all' }).verdict).toBe('risky');
    expect(mapZeroBounce({ error: 'Invalid API key' }).verdict).toBe('unknown');
  });
});

describe('verifyMailbox', () => {
  it('is skipped (no network call) without an API key', async () => {
    const f = json({});
    expect((await verifyMailbox('a@b.co', { fetchImpl: f, env: {} })).verdict).toBe('skipped');
    expect(f).not.toHaveBeenCalled();
  });
  it('calls the configured provider', async () => {
    const f = json({ result: 'ok' });
    expect((await verifyMailbox('a@b.co', { fetchImpl: f, env: { EMAIL_VERIFY_API_KEY: 'k' } })).verdict).toBe('deliverable');
    expect(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('api.millionverifier.com');
    const z = json({ status: 'valid' });
    await verifyMailbox('a@b.co', { fetchImpl: z, env: { EMAIL_VERIFY_API_KEY: 'k', EMAIL_VERIFY_PROVIDER: 'zerobounce' } });
    expect(String((z as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('api.zerobounce.net');
  });
  it('fails open (unknown) on HTTP errors and exceptions', async () => {
    expect((await verifyMailbox('a@b.co', { fetchImpl: json({}, false), env: { EMAIL_VERIFY_API_KEY: 'k' } })).verdict).toBe('unknown');
    const boom = vi.fn(async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
    expect((await verifyMailbox('a@b.co', { fetchImpl: boom, env: { EMAIL_VERIFY_API_KEY: 'k' } })).verdict).toBe('unknown');
  });
});

describe('shouldBlock', () => {
  it('blocks undeliverable only; catch-all only when BLOCK_RISKY=on; never blocks unknown/skipped', () => {
    expect(shouldBlock({ verdict: 'undeliverable', provider: 'x' }, {})).toBe(true);
    expect(shouldBlock({ verdict: 'risky', provider: 'x' }, {})).toBe(false);
    expect(shouldBlock({ verdict: 'risky', provider: 'x' }, { EMAIL_VERIFY_BLOCK_RISKY: 'on' })).toBe(true);
    expect(shouldBlock({ verdict: 'unknown', provider: 'x' }, { EMAIL_VERIFY_BLOCK_RISKY: 'on' })).toBe(false);
    expect(shouldBlock({ verdict: 'skipped', provider: 'x' }, {})).toBe(false);
  });
});

describe('verifyLeadEmail caching', () => {
  function sb() { const updates: unknown[] = []; return { updates, client: { from: () => ({ update: (v: unknown) => { updates.push(v); return { eq: async () => ({ error: null }) }; } }) } as never }; }
  const env = { EMAIL_VERIFY_API_KEY: 'k' };
  beforeEach(() => vi.clearAllMocks());

  it('stores a definitive result on the lead and does not pay twice for the same address', async () => {
    const s = sb(); const f = json({ result: 'ok' });
    const lead = { id: 'l1', signals: { keep: 1 } as Record<string, unknown> };
    await verifyLeadEmail(s.client, lead, 'A@B.co', { fetchImpl: f, env });
    expect(f).toHaveBeenCalledTimes(1);
    const saved = (s.updates[0] as { signals: Record<string, unknown> }).signals;
    expect(saved.keep).toBe(1);
    expect(saved.emailVerification).toMatchObject({ email: 'a@b.co', verdict: 'deliverable' });
    const again = await verifyLeadEmail(s.client, { id: 'l1', signals: saved }, 'a@b.co', { fetchImpl: f, env });
    expect(again).toMatchObject({ verdict: 'deliverable', cached: true });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('re-verifies a different address, a stale entry, and never caches unknown', async () => {
    const s = sb(); const f = json({ result: 'ok' });
    const old = { emailVerification: { email: 'a@b.co', verdict: 'deliverable', provider: 'x', at: new Date(Date.now() - 40 * 864e5).toISOString() } };
    await verifyLeadEmail(s.client, { id: 'l1', signals: old }, 'a@b.co', { fetchImpl: f, env });
    await verifyLeadEmail(s.client, { id: 'l1', signals: { emailVerification: { email: 'z@b.co', verdict: 'deliverable', provider: 'x', at: new Date().toISOString() } } }, 'a@b.co', { fetchImpl: f, env });
    expect(f).toHaveBeenCalledTimes(2);
    const s2 = sb();
    await verifyLeadEmail(s2.client, { id: 'l2', signals: {} }, 'q@b.co', { fetchImpl: json({ result: 'unknown' }), env });
    expect(s2.updates).toHaveLength(0);
  });
});
