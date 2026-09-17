import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';

// GET/PATCH a single tenant, server-side (service role) — src/lib/api.ts's
// getTenant/updateTenant used to hit calldesk_tenants directly from the
// browser with the anon key. That table's RLS policies check
// `auth.uid()::text = user_id`, but this app authenticates via NextAuth
// (Google), not Supabase Auth — auth.uid() is always NULL for an anon-key
// request here, so every one of those calls has been silently blocked by
// RLS since the app's first deploy (found 2026-09-06: Settings page never
// actually loaded a tenant in production). Routing through the server with
// the service-role key is the same fix already used everywhere else in
// this API surface — this table just never got the same treatment.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_tenants')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tenant: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const updates = await request.json();
  const { data, error } = await supabase
    .from('calldesk_tenants')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Real per-tenant recording/retention control (2026-09-17): for a
  // retell-engine tenant, WE never receive/store the recording ourselves —
  // Retell does, on their own S3 bucket — so enforcing this setting means
  // pushing it to Retell's own agent config (their data_storage_setting/
  // data_storage_retention_days), not just remembering a preference here
  // that nothing downstream would ever act on. Only fires when this save
  // actually touched the recording settings and there's a real Retell agent
  // to push to. Best-effort — a Retell API hiccup shouldn't fail the tenant
  // settings save that triggered it.
  const settings = updates.settings as Record<string, string> | undefined;
  if (settings && 'recording_enabled' in settings && data.retell_agent_id) {
    try {
      const retell = getRetellClient();
      const retentionDays = settings.recording_retention_days ? Number(settings.recording_retention_days) : null;
      await retell.updateAgent(data.retell_agent_id, {
        dataStorageSetting: settings.recording_enabled === 'false' ? 'basic_attributes_only' : 'everything',
        dataStorageRetentionDays: retentionDays && retentionDays > 0 ? retentionDays : null,
      });
    } catch (err) {
      console.error('Failed to push recording setting to Retell (non-fatal):', err);
    }
  }

  return NextResponse.json({ tenant: data });
}
