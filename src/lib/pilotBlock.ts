import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pilotBlockedBody } from '@/lib/pilotBlockShared';

export * from '@/lib/pilotBlockShared';

// A pilot tenant that the hourly pilot-watch job has blocked (calldesk_tenants.pilot_blocked, see pilotJobs.ts) must not place
// outbound calls either. The voice engine refuses the same calls on its side; this is the web app's half.

// 42703 undefined column, PGRST204 column not in schema cache: migration 068 (pilot_blocked) is not applied yet.
function isMissingBlockColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === '42703' || e.code === 'PGRST204' || /pilot_blocked/.test(e.message || ''));
}

/**
 * True when the tenant is pilot-blocked. Fails open ONLY when the column does not exist (migration not applied, nobody can be blocked).
 * Any other database error throws: a blocked tenant must never slip through because the check could not run.
 */
export async function isTenantPilotBlocked(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data, error } = await supabase.from('calldesk_tenants').select('pilot_blocked').eq('id', tenantId).maybeSingle();
  if (error) {
    if (isMissingBlockColumn(error)) return false;
    throw new Error(`pilot block check failed: ${error.message || error.code || 'unknown error'}`);
  }
  return !!(data as { pilot_blocked?: boolean | null } | null)?.pilot_blocked;
}

/**
 * Route guard: null when the tenant may place outbound calls, otherwise the response to return before any provider/engine request.
 * 403 pilot_blocked when blocked; 503 when the check itself failed (fail closed).
 */
export async function pilotBlockResponse(supabase: SupabaseClient, tenantId: string | null | undefined): Promise<NextResponse | null> {
  if (!tenantId) return null;
  try {
    if (await isTenantPilotBlocked(supabase, tenantId)) return NextResponse.json(pilotBlockedBody(), { status: 403 });
    return null;
  } catch (err) {
    console.error('[pilotBlock]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'pilot_check_failed', code: 'pilot_check_failed', message: 'Could not verify this workspace is allowed to place calls. Try again shortly.' }, { status: 503 });
  }
}

