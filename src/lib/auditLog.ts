import { getSupabaseAdmin } from '@/lib/supabase';

// Append-only audit trail for security-relevant actions (migration 039).
// Fire-and-forget by design, same pattern as the API-key last_used_at stamp
// in src/lib/authz.ts: a logging failure must never block or fail the
// underlying request. Callers should still `await` this so the write is
// issued before the response is returned (helps tests/verification see the
// row immediately), but its result is intentionally ignored.
export type AuditAction =
  | 'team.invite'
  | 'team.role_change'
  | 'team.remove'
  | 'apikey.create'
  | 'apikey.revoke'
  | 'agent.delete';

export async function logAudit(params: {
  tenantId: string | null;
  actorUserId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getSupabaseAdmin().from('calldesk_audit_log').insert({
      tenant_id: params.tenantId,
      actor_user_id: params.actorUserId,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId ?? null,
      metadata: params.metadata ?? {},
    });
  } catch {
    // Never let audit logging break the request it's logging.
  }
}
