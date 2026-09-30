import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireTenantRole } from '@/lib/authz';
import { CALL_AUDIO_TABLE, CALL_AUDIO_BUCKET } from '@/lib/callAudio/supabaseDeps';

// DELETE — remove one asset (row + stored audio). Owner/admin only: it changes what live callers hear.
// Both the lookup and the delete are scoped to the tenant, so an asset id from another tenant is a 404.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: tenantId, assetId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: true });
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase
    .from(CALL_AUDIO_TABLE).select('mulaw8k_storage_path').eq('tenant_id', tenantId).eq('id', assetId).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await supabase.from(CALL_AUDIO_TABLE).delete().eq('tenant_id', tenantId).eq('id', assetId);
  if (error) return NextResponse.json({ error: 'Could not delete this audio' }, { status: 500 });
  // Row first, then object: a leftover object is harmless garbage; a row pointing at a missing object would break playback.
  await supabase.storage.from(CALL_AUDIO_BUCKET).remove([row.mulaw8k_storage_path]);
  return NextResponse.json({ ok: true });
}
