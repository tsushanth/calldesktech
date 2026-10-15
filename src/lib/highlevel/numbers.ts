import { getSupabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from './phone';

/** The workspace number a HighLevel call is placed from: the one asked for, or the only one with an Outbound Call Agent. */
export async function resolveFromNumber(
  tenantId: string,
  requested?: unknown,
): Promise<{ ok: true; phoneNumberId: string } | { ok: false; error: string }> {
  const { data } = await getSupabaseAdmin()
    .from('calldesk_phone_numbers')
    .select('id, number')
    .eq('tenant_id', tenantId)
    .not('outbound_agent_version_id', 'is', null);
  const numbers = (data ?? []) as Array<{ id: string; number: string }>;
  if (numbers.length === 0) return { ok: false, error: 'This workspace has no phone number with an Outbound Call Agent. Set one in Calldesk under Numbers.' };

  const asked = typeof requested === 'string' && requested.trim() ? normalizePhone(requested) : null;
  if (typeof requested === 'string' && requested.trim()) {
    const hit = asked ? numbers.find((n) => normalizePhone(n.number) === asked) : undefined;
    return hit ? { ok: true, phoneNumberId: hit.id } : { ok: false, error: `"${requested.trim().slice(0, 30)}" is not one of this workspace's outbound numbers: ${numbers.map((n) => n.number).join(', ')}` };
  }
  if (numbers.length === 1) return { ok: true, phoneNumberId: numbers[0].id };
  return { ok: false, error: `This workspace has several outbound numbers. Fill in "Call from" with one of: ${numbers.map((n) => n.number).join(', ')}` };
}
