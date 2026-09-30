import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';
import { CALL_AUDIO_TABLE, CALL_AUDIO_BUCKET } from '@/lib/callAudio/supabaseDeps';
import { mulawToWav } from '@/lib/callAudio/mulaw';

// GET — a playable WAV of the stored asset, so the dashboard can preview exactly what callers hear.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id: tenantId, assetId } = await params;
  const auth = await authorizeTenant(request, tenantId);
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase
    .from(CALL_AUDIO_TABLE).select('mulaw8k_storage_path').eq('tenant_id', tenantId).eq('id', assetId).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: blob, error } = await supabase.storage.from(CALL_AUDIO_BUCKET).download(row.mulaw8k_storage_path);
  if (error || !blob) return NextResponse.json({ error: 'Audio unavailable' }, { status: 502 });
  const wav = mulawToWav(Buffer.from(await blob.arrayBuffer()));
  return new NextResponse(new Uint8Array(wav), { headers: { 'content-type': 'audio/wav', 'cache-control': 'private, max-age=300' } });
}
