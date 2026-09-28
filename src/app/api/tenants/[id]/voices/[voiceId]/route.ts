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
