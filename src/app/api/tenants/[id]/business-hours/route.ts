import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/business-hours — get the tenant's office hours,
// timezone, after-hours routing, and message.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_business_hours')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Return a well-formed "nothing here yet" payload so the client can render
  // an empty state rather than an error.
  if (!data) {
    return NextResponse.json({
      timezone: 'America/New_York',
      hours: {},
      after_hours_number: null,
      after_hours_agent_version_id: null,
      after_hours_message: null,
    });
  }
  return NextResponse.json(data);
}

// POST /api/tenants/[id]/business-hours — create or update hours.
// Upserts on tenant_id so callers can repeatedly save without worrying
// about whether a row already exists.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;

  const body = await request.json();
  const payload: Record<string, unknown> = { tenant_id: tenantId };
  if (body.timezone !== undefined) payload.timezone = body.timezone;
  if (body.hours !== undefined) payload.hours = body.hours;
  if (body.afterHoursNumber !== undefined) payload.after_hours_number = body.afterHoursNumber;
  if (body.afterHoursAgentVersionId !== undefined) payload.after_hours_agent_version_id = body.afterHoursAgentVersionId;
  if (body.afterHoursMessage !== undefined) payload.after_hours_message = body.afterHoursMessage;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_business_hours')
    .upsert(payload, { onConflict: 'tenant_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
