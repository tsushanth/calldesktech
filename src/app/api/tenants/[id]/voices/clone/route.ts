import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

// POST /api/tenants/[id]/voices/clone
// Clone a voice from an audio sample URL via ElevenLabs, then register the
// resulting voice_id in calldesk_voices for use with poc (tts_backend=elevenlabs)
// or retell engines.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;

  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { name, description, sampleUrl, labels } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!sampleUrl || typeof sampleUrl !== 'string') {
    return NextResponse.json({ error: 'sampleUrl is required (audio file URL)' }, { status: 400 });
  }

  // --- 1. Download sample audio from provided URL ---
  let sampleBuffer: ArrayBuffer;
  try {
    const sampleRes = await fetch(sampleUrl, { signal: AbortSignal.timeout(30_000) });
    if (!sampleRes.ok) {
      return NextResponse.json({ error: `Failed to download sample: HTTP ${sampleRes.status}` }, { status: 400 });
    }
    const contentType = sampleRes.headers.get('content-type') || '';
    if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) {
      // Allow but warn — URL might be a presigned S3 link that reports binary/octet-stream
      console.warn('[voice clone] Sample content-type:', contentType);
    }
    sampleBuffer = await sampleRes.arrayBuffer();
    if (sampleBuffer.byteLength < 1024) {
      return NextResponse.json({ error: 'Sample audio too small — must be at least 1 KB' }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'download failed';
    return NextResponse.json({ error: `Failed to download sample: ${msg}` }, { status: 400 });
  }

  // --- 2. Upload to ElevenLabs voice cloning ---
  const form = new FormData();
  form.append('name', name.slice(0, 100));
  if (description) form.append('description', description.slice(0, 500));
  form.append('files', new Blob([sampleBuffer], { type: 'audio/mpeg' }), 'sample.mp3');
  if (labels && typeof labels === 'object') {
    form.append('labels', JSON.stringify(labels));
  }

  let elevenlabsRes: Response;
  try {
    elevenlabsRes = await fetch(`${ELEVENLABS_BASE}/v1/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'ElevenLabs request failed';
    return NextResponse.json({ error: `ElevenLabs connection failed: ${msg}` }, { status: 502 });
  }

  const elBody = await elevenlabsRes.json().catch(() => ({} as Record<string, unknown>));
  if (!elevenlabsRes.ok) {
    const detail = typeof elBody.detail === 'string'
      ? elBody.detail
      : Array.isArray(elBody.detail)
        ? elBody.detail.map((d: any) => d.msg || JSON.stringify(d)).join('; ')
        : JSON.stringify(elBody).slice(0, 200);
    return NextResponse.json({ error: `ElevenLabs: ${detail}` }, { status: 502 });
  }

  const voiceId = (elBody.voice_id as string) || (elBody as any).id;
  if (!voiceId || typeof voiceId !== 'string') {
    return NextResponse.json({ error: `ElevenLabs response missing voice_id: ${JSON.stringify(elBody).slice(0, 200)}` }, { status: 502 });
  }

  // --- 3. Store in calldesk_voices ---
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from('calldesk_voices')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', voiceId)
    .maybeSingle();

  const insertPayload = {
    id: voiceId,
    tenant_id: tenantId,
    name: name.slice(0, 100),
    gender: body.gender ?? null,
    language: body.language ?? 'en',
    accent: body.accent ?? null,
    engine: body.engine ?? 'poc',
    tts_backend: 'elevenlabs' as const,
    sample_url: sampleUrl,
    is_active: true,
    metadata: {
      ...(body.metadata ?? {}),
      cloned: true,
      elevenlabs_voice_id: voiceId,
      labels: labels ?? {},
    },
  };

  let dbResult;
  if (existing) {
    const { data, error } = await supabase
      .from('calldesk_voices')
      .update(insertPayload)
      .eq('tenant_id', tenantId)
      .eq('id', voiceId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    dbResult = data;
  } else {
    const { data, error } = await supabase
      .from('calldesk_voices')
      .insert(insertPayload)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    dbResult = data;
  }

  return NextResponse.json({
    voice: dbResult,
    elevenlabs: { voice_id: voiceId },
  }, { status: 201 });
}
