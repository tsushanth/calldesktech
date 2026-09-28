import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/phone-numbers — list a tenant's phone numbers
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_phone_numbers')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ phoneNumbers: data });
}

// POST /api/tenants/[id]/phone-numbers — register a number, unrouted.
// If you pass source: 'ported', the number is treated as "bring your own"
// and no purchase is attempted — it's just recorded in the dashboard so
// you can route it (typically via carrier call-forwarding to one of your
// purchased numbers, until full SIP trunking is configured).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { number, source = 'ported', label, metadata } = await request.json();

  if (!number) {
    return NextResponse.json({ error: 'number is required (E.164 format)' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('calldesk_phone_numbers')
    .insert({
      tenant_id: tenantId,
      number,
      source,
      label: label ?? null,
      metadata: metadata ?? {},
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ phoneNumber: data }, { status: 201 });
}
