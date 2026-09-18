import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/contacts — the distinct callers who've ever called in,
// aggregated from calldesk_call_logs, joined to their calldesk_contacts row
// (which only exists once someone has set a flag like Do Not Call on them).
//
// Server-side + service-role on purpose: querying Supabase directly from the
// client is silently blocked by RLS (see stats/route.ts for the same pattern).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  const [{ data: logs, error: logsError }, { data: contacts, error: contactsError }] = await Promise.all([
    supabase
      .from('calldesk_call_logs')
      .select('caller_phone, created_at')
      .eq('tenant_id', tenantId),
    supabase
      .from('calldesk_contacts')
      .select('caller_phone, do_not_call')
      .eq('tenant_id', tenantId),
  ]);

  if (logsError) return NextResponse.json({ error: logsError.message }, { status: 500 });
  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });

  const dncByPhone = new Map<string, boolean>(
    (contacts || []).map((c) => [c.caller_phone, c.do_not_call])
  );

  // Aggregate call logs by caller_phone into one row per distinct number.
  const byPhone = new Map<
    string,
    { caller_phone: string; first_seen: string; last_contact: string; total_calls: number }
  >();

  for (const log of logs || []) {
    if (!log.caller_phone) continue;
    const existing = byPhone.get(log.caller_phone);
    if (!existing) {
      byPhone.set(log.caller_phone, {
        caller_phone: log.caller_phone,
        first_seen: log.created_at,
        last_contact: log.created_at,
        total_calls: 1,
      });
    } else {
      existing.total_calls += 1;
      if (log.created_at < existing.first_seen) existing.first_seen = log.created_at;
      if (log.created_at > existing.last_contact) existing.last_contact = log.created_at;
    }
  }

  const contactsList = Array.from(byPhone.values())
    .map((c) => ({ ...c, do_not_call: dncByPhone.get(c.caller_phone) ?? false }))
    .sort((a, b) => (a.last_contact < b.last_contact ? 1 : -1));

  return NextResponse.json({ contacts: contactsList });
}

// PATCH /api/tenants/[id]/contacts — set a flag (currently just Do Not Call) on
// one caller number. Upserts the calldesk_contacts row lazily so numbers that
// have never been flagged don't need a row until they're actually touched.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { caller_phone, do_not_call } = await request.json();

  if (!caller_phone) {
    return NextResponse.json({ error: 'caller_phone is required' }, { status: 400 });
  }
  if (typeof do_not_call !== 'boolean') {
    return NextResponse.json({ error: 'do_not_call must be a boolean' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('calldesk_contacts')
    .upsert(
      { tenant_id: tenantId, caller_phone, do_not_call },
      { onConflict: 'tenant_id,caller_phone' }
    )
    .select('caller_phone, do_not_call')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}
