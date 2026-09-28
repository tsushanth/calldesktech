import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/voices/[voiceId] — get a single voice.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; voiceId: string }> }
) {
  const { id: tenantId, voiceId } = await params;
  const __auth = await authorizeTenant(request, tenantId);
  if (!__auth.ok) return __auth.response;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_voices')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', voiceId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ voice: data });
}

// PATCH /api/tenants/[id]/voices/[voiceId] — update a voice (rename, set
// favourite, deactivate, etc.). Does not allow changing the id or tenant_id.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; voiceId: string }> }
) {
  const { id: tenantId, voiceId } = await params;
  const __auth = await authorizeTenant(request, tenantId);
  if (!__auth.ok) return __auth.response;

  const body = await request.json();
  const payload: Record<string, unknown> = {};
  if (body.name !== undefined) payload.name = body.name;
  if (body.gender !== undefined) payload.gender = body.gender;
  if (body.language !== undefined) payload.language = body.language;
  if (body.accent !== undefined) payload.accent = body.accent;
  if (body.sampleUrl !== undefined) payload.sample_url = body.sampleUrl;
  if (body.isActive !== undefined) payload.is_active = body.isActive;
  if (body.metadata !== undefined) payload.metadata = body.metadata;

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_voices')
    .update(payload)
    .eq('tenant_id', tenantId)
    .eq('id', voiceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ voice: data });
}

// DELETE /api/tenants/[id]/voices/[voiceId] — soft-delete (set is_active
// false) so published agent versions that reference it stay valid.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; voiceId: string }> }
) {
  const { id: tenantId, voiceId } = await params;
  const __auth = await authorizeTenant(request, tenantId);
  if (!__auth.ok) return __auth.response;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_voices')
    .update({ is_active: false })
    .eq('tenant_id', tenantId)
    .eq('id', voiceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ voice: data });
}
