import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';
import { getVoiceEngine } from '@/lib/voiceEngine';
import { getStaticVoices } from '@/lib/voices';

// GET /api/tenants/[id]/voices — list voices for this tenant.
// On first call, seeds the static voice library into calldesk_voices so
// the tenant can rename, hide, or favourite them. After seeding, returns
// the DB rows (name overrides are preserved).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;

  const supabase = getSupabaseAdmin();
  const { data: tenant } = await supabase
    .from('calldesk_tenants')
    .select('settings')
    .eq('id', tenantId)
    .single();

  const engine = getVoiceEngine(tenant?.settings ?? null);
  const staticVoices = getStaticVoices(engine);

  // Ensure every static voice exists in the tenant's DB
  const existing = await supabase
    .from('calldesk_voices')
    .select('id')
    .eq('tenant_id', tenantId);
  const existingIds = new Set((existing.data || []).map((v) => v.id));

  const missing = staticVoices.filter((v) => !existingIds.has(v.id));
  if (missing.length > 0) {
    await supabase.from('calldesk_voices').insert(
      missing.map((v) => ({ ...v, tenant_id: tenantId }))
    );
  }

  const { data, error } = await supabase
    .from('calldesk_voices')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('engine', engine)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ voices: data || [] });
}

// POST /api/tenants/[id]/voices — add a custom voice (clone, upload, or
// third-party integration). Custom voices get id prefix 'custom-' to avoid
// colliding with static ones.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;

  const body = await request.json();
  if (!body.name || !body.id) {
    return NextResponse.json({ error: 'id and name are required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_voices')
    .insert({
      id: body.id,
      tenant_id: tenantId,
      name: body.name,
      gender: body.gender ?? null,
      language: body.language ?? 'en',
      accent: body.accent ?? null,
      engine: body.engine ?? 'poc',
      tts_backend: body.ttsBackend ?? null,
      sample_url: body.sampleUrl ?? null,
      metadata: body.metadata ?? {},
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ voice: data }, { status: 201 });
}
