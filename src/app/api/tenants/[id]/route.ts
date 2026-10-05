import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { authorizeTenant, requireTenantRole } from '@/lib/authz';
import { parseTenantUpdates, protectServerManagedSettings } from '@/lib/tenantUpdates';

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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

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
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const parsed = parseTenantUpdates(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const updates = parsed.updates;
  if (updates.settings) {
    // Keep server-managed keys (billing/activation flags) out of the tenant's reach, whatever it sends.
    const { data: current } = await supabase.from('calldesk_tenants').select('settings').eq('id', id).maybeSingle();
    updates.settings = protectServerManagedSettings(current?.settings, updates.settings as Record<string, unknown>);
  }
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

// DELETE /api/tenants/[id] - permanently delete a workspace and everything in it (agents, flows, call logs, knowledge bases,
// contacts, API keys, team) through the ON DELETE CASCADE foreign keys. Owner only, never through an API key.
// Refused (409) when it would leave the owner with no workspace, or while the workspace still holds phone numbers: those are
// rented from the carrier and deleting the row would leave them billed with nothing pointing at them. Release them first.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireTenantRole(request, id, ['owner'], { apiKeysAllowed: false });
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();
  const { data: tenant, error: tenantError } = await supabase.from('calldesk_tenants').select('id, user_id, name').eq('id', id).maybeSingle();
  if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 500 });
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { count: ownedCount } = await supabase.from('calldesk_tenants').select('id', { count: 'exact', head: true }).eq('user_id', tenant.user_id);
  if ((ownedCount ?? 0) <= 1) {
    return NextResponse.json({ error: 'This is your only workspace, so it cannot be deleted. Create another one first.' }, { status: 409 });
  }

  const { count: numberCount } = await supabase.from('calldesk_phone_numbers').select('id', { count: 'exact', head: true }).eq('tenant_id', id);
  if ((numberCount ?? 0) > 0) {
    return NextResponse.json({ error: `This workspace still has ${numberCount} phone number${numberCount === 1 ? '' : 's'}. Release ${numberCount === 1 ? 'it' : 'them'} on the Phone Numbers page first, so you are not billed for ${numberCount === 1 ? 'a number' : 'numbers'} with no workspace.` }, { status: 409 });
  }

  const { error } = await supabase.from('calldesk_tenants').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true, id });
}
