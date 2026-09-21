'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useOnboarding } from '@/context/OnboardingContext';

type Role = 'owner' | 'admin' | 'member';
type Status = 'active' | 'invited';

interface Member {
  id: string;
  user_id: string | null;
  invited_email: string | null;
  email: string | null;
  name: string | null;
  role: Role;
  status: Status;
  created_at: string;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TeamPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const { data: session } = useSession();

  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [isInviting, setIsInviting] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setError('');
    try {
      const res = await fetch(`/api/tenants/${tenantId}/team`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load team');
      setMembers(body.members || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!isHydrated) return;
    load();
  }, [isHydrated, load]);

  // Current user's own role, so we can show/hide manage controls. If we
  // can't tell yet (still loading), default to hiding manage controls
  // rather than briefly flashing them.
  const myRow = members.find((m) => m.user_id === session?.user?.id);
  const myRole: Role | null = myRow?.role ?? null;
  const canManage = myRole === 'owner' || myRole === 'admin';

  const invite = async () => {
    if (!tenantId || !inviteEmail.trim()) return;
    setIsInviting(true);
    setError('');
    try {
      const res = await fetch(`/api/tenants/${tenantId}/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to invite');
      setInviteEmail('');
      setInviteRole('member');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setIsInviting(false);
    }
  };

  const changeRole = async (memberId: string, role: 'admin' | 'member') => {
    if (!tenantId) return;
    setError('');
    try {
      const res = await fetch(`/api/tenants/${tenantId}/team/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to change role');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role');
    }
  };

  const remove = async (memberId: string) => {
    if (!tenantId) return;
    setError('');
    try {
      const res = await fetch(`/api/tenants/${tenantId}/team/${memberId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to remove');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  if (isLoading) {
    return <div className="p-10 text-center text-[13.5px] text-gray-400">Loading team…</div>;
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Team</h1>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>
      )}

      <div className="space-y-5">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-[14px] font-semibold text-[#1a1d29]">Members</h2>
          <div className="divide-y divide-gray-100">
            {members.length === 0 && <p className="py-4 text-[13.5px] text-gray-400">No team members yet.</p>}
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-[13.5px] font-medium text-[#1a1d29]">
                    {m.name || m.email || m.invited_email || 'Unknown'}
                  </p>
                  <p className="text-[12px] text-gray-400">
                    {m.status === 'invited' ? `Invited ${fmt(m.created_at)} — pending` : `Joined ${fmt(m.created_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {canManage && m.role !== 'owner' ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value as 'admin' | 'member')}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12.5px] focus:border-blue-400 focus:outline-none"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <span className="rounded-full border border-gray-200 px-2.5 py-1 text-[11.5px] font-medium capitalize text-gray-500">
                      {m.role}
                    </span>
                  )}
                  {canManage && m.role !== 'owner' && (
                    <button
                      onClick={() => remove(m.id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-[12px] font-medium text-red-600 transition hover:bg-red-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {canManage && (
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-[14px] font-semibold text-[#1a1d29]">Invite someone</h2>
            <p className="mb-4 text-[12.5px] text-gray-400">
              This creates a pending invite — no email is sent yet. Share the dashboard URL with them directly; the
              invite is accepted automatically the next time they sign in with this email.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                  className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                onClick={invite}
                disabled={isInviting || !inviteEmail.trim()}
                className="rounded-lg bg-[#1a1d29] px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-50"
              >
                {isInviting ? 'Inviting…' : 'Invite'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
