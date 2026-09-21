import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateWebhookSecret, WEBHOOK_EVENT_IDS } from '@/lib/webhooks';
import { authorizeTenant, requireTenantRole } from '@/lib/authz';

// GET /api/tenants/[id]/webhooks — list a tenant's outbound webhooks.
// The signing secret is returned so the UI can show it (it's the tenant's
// own secret, scoped to their tenant), matching how the config page needs it
// to display verification setup.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_webhooks')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhooks: data });
}

// POST /api/tenants/[id]/webhooks — register a new endpoint. Generates the
// signing secret server-side; the client never picks it.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await requireTenantRole(request, (await params).id, ['owner', 'admin'], { apiKeysAllowed: false });
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { url, events } = await request.json();

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'A webhook URL is required' }, { status: 400 });
  }
  // Only allow http(s) endpoints — guards against a stray non-URL string
  // being POSTed to on every call.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'URL must be http or https' }, { status: 400 });
  }

  // Keep only recognized event ids; reject a subscription to nothing.
  const requested: string[] = Array.isArray(events) ? events : [];
  const validEvents = requested.filter((e) => (WEBHOOK_EVENT_IDS as string[]).includes(e));
  if (validEvents.length === 0) {
    return NextResponse.json(
      { error: 'Select at least one event to subscribe to' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('calldesk_webhooks')
    .insert({
      tenant_id: tenantId,
      url,
      events: validEvents,
      secret: generateWebhookSecret(),
      enabled: true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhook: data }, { status: 201 });
}
