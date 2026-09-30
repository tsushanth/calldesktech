import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant, requireTenantRole } from '@/lib/authz';
import { createCallAudioAsset, type CallAudioType } from '@/lib/callAudio/assets';
import { generateSoundEffectWav } from '@/lib/callAudio/readaloudClient';
import { makeSupabaseCallAudioDeps, CALL_AUDIO_TABLE } from '@/lib/callAudio/supabaseDeps';
import { toHttpError } from '@/lib/callAudio/errors';

// ReadAloud generation can take ~60s on a cold GPU worker.
export const maxDuration = 120;

const READALOUD_MCP_URL = process.env.READALOUD_MCP_URL || 'https://readaloudai.org/mcp';

// GET — the tenant's assets (metadata only; audio is fetched via .../[assetId]/audio for preview).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await authorizeTenant(request, tenantId);
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin()
    .from(CALL_AUDIO_TABLE)
    .select('id, asset_type, name, description, enabled, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Could not load call audio' }, { status: 500 });
  return NextResponse.json({ assets: data ?? [] });
}

// POST — generate + store a jingle or sound effect (replacing the tenant's current one it supersedes).
// Owner/admin only, session only: it spends ReadAloud credits and changes what live callers hear.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const auth = await requireTenantRole(request, tenantId, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (
    !body || typeof body.prompt !== 'string' || typeof body.name !== 'string' || typeof body.type !== 'string' ||
    typeof body.durationSec !== 'number' || (body.description !== undefined && typeof body.description !== 'string')
  ) {
    return NextResponse.json({ error: 'type, name, prompt and durationSec are required' }, { status: 400 });
  }

  try {
    const deps = makeSupabaseCallAudioDeps(getSupabaseAdmin(), {
      generateWav: (input) => generateSoundEffectWav(input, { apiKey: process.env.READALOUD_API_KEY, url: READALOUD_MCP_URL }),
    });
    const asset = await createCallAudioAsset(
      { tenantId, type: body.type as CallAudioType, name: body.name, description: body.description ?? '', prompt: body.prompt, durationSec: body.durationSec },
      deps
    );
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    const { status, message } = toHttpError(err);
    if (status >= 500) console.error('[call-audio] create failed', err);
    return NextResponse.json({ error: message }, { status });
  }
}
