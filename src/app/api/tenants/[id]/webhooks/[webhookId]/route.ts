import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { WEBHOOK_EVENT_IDS } from '@/lib/webhooks';
import { requireTenantRole } from '@/lib/authz';

// PATCH /api/tenants/[id]/webhooks/[webhookId] — toggle enabled or edit events.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; webhookId: string }> }
) {
  const __auth = await requireTenantRole(request, (await params).id, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!__auth.ok) return __auth.response;

  const { id: tenantId, webhookId } = await params;
  const supabase = getSupabaseAdmin();
  const body = await request.json();

  const updates: { enabled?: boolean; events?: string[] } = {};
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
  if (Array.isArray(body.events)) {
    const validEvents = body.events.filter((e: string) =>
      (WEBHOOK_EVENT_IDS as string[]).includes(e)
    );
    if (validEvents.length === 0) {
      return NextResponse.json({ error: 'Select at least one event' }, { status: 400 });
    }
    updates.events = validEvents;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('calldesk_webhooks')
    .update(updates)
    .eq('id', webhookId)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhook: data });
}

// DELETE /api/tenants/[id]/webhooks/[webhookId] — remove an endpoint.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; webhookId: string }> }
) {
  const __auth = await requireTenantRole(request, (await params).id, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!__auth.ok) return __auth.response;

  const { id: tenantId, webhookId } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('calldesk_webhooks')
    .delete()
    .eq('id', webhookId)
    .eq('tenant_id', tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
