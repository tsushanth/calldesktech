import { getSupabaseAdmin } from '@/lib/supabase';
import { adminEmails } from '@/lib/outreach/config';

export interface Person {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  workspaces: number;
  agents: number;
  versions: number;
  calls: number;
  lastActivity: string;
  internal: boolean;
}

/** Everyone who has signed in, with what they built, straight from our database. */
export async function loadPeople(): Promise<Person[]> {
  const db = getSupabaseAdmin();
  const [users, tenants, agents, versions, calls] = await Promise.all([
    db.from('calldesk_users').select('id, email, name, created_at').order('created_at', { ascending: false }).limit(500),
    db.from('calldesk_tenants').select('id, user_id, created_at').limit(5000),
    db.from('calldesk_agents').select('id, tenant_id, created_at').limit(10000),
    db.from('calldesk_agent_versions').select('agent_id, created_at').limit(20000),
    db.from('calldesk_call_logs').select('tenant_id, created_at').neq('is_internal_test', true).limit(20000),
  ]);

  const tenantOwner = new Map((tenants.data || []).map((t) => [t.id as string, t.user_id as string]));
  const agentTenant = new Map((agents.data || []).map((a) => [a.id as string, a.tenant_id as string]));
  const admins = adminEmails();

  return (users.data || []).map((u): Person => {
    const mine = (tenants.data || []).filter((t) => t.user_id === u.id);
    const mineIds = new Set(mine.map((t) => t.id as string));
    const myAgents = (agents.data || []).filter((a) => mineIds.has(a.tenant_id as string));
    const myVersions = (versions.data || []).filter((v) => mineIds.has(agentTenant.get(v.agent_id as string) || ''));
    const myCalls = (calls.data || []).filter((c) => tenantOwner.get(c.tenant_id as string) === u.id);
    const stamps = [u.created_at, ...mine.map((t) => t.created_at), ...myAgents.map((a) => a.created_at), ...myVersions.map((v) => v.created_at), ...myCalls.map((c) => c.created_at)].map(String);
    return {
      id: u.id as string,
      email: String(u.email || ''),
      name: (u.name as string | null) ?? null,
      createdAt: String(u.created_at),
      workspaces: mine.length,
      agents: myAgents.length,
      versions: myVersions.length,
      calls: myCalls.length,
      lastActivity: stamps.sort().at(-1) || String(u.created_at),
      internal: admins.includes(String(u.email || '').toLowerCase()),
    };
  });
}
