// Our own workspaces (owned by an admin account, or created by the demo wizard) generate the demo and test
// calls. Reports about customers must leave them out, and the per-call is_internal_test flag alone misses most.
export interface TenantRow { id: string; user_id: string | null }
export interface UserRow { id: string | number; email: string | null }

export function internalTenantIds(tenants: TenantRow[], users: UserRow[], adminEmails: string[]): Set<string> {
  const admins = new Set(adminEmails.map((e) => e.toLowerCase()));
  const ownerIds = new Set(users.filter((u) => admins.has((u.email || '').toLowerCase())).map((u) => String(u.id)));
  return new Set(tenants.filter((t) => !t.user_id || t.user_id.startsWith('demo_') || ownerIds.has(String(t.user_id))).map((t) => t.id));
}
