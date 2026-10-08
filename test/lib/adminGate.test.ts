import { describe, it, expect, vi, beforeEach } from 'vitest';

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const { adminGate } = await import('@/lib/outreach/adminGate');

describe('adminGate: the three cases that must stay distinct', () => {
  beforeEach(() => { getServerSession.mockReset(); process.env.ADMIN_EMAILS = 'Owner@Example.com, other@example.com'; });

  it('signed out: redirects to sign-in with the callback address', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(adminGate('/admin/usage')).rejects.toMatchObject({ digest: expect.stringContaining('/auth/signin?callbackUrl=%2Fadmin%2Fusage') });
  });

  it('signed in but not on the admin list: returns denied (never a redirect, which looped forever through the sign-in page)', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'wife@example.com' } });
    await expect(adminGate('/admin/usage')).resolves.toEqual({ deniedFor: 'wife@example.com' });
  });

  it('signed in on the admin list (case-insensitive): returns the admin', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'owner@example.com' } });
    await expect(adminGate('/admin/pilots')).resolves.toEqual({ email: 'owner@example.com' });
  });
});
