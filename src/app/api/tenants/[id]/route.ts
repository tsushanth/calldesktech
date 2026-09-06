import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET/PATCH a single tenant, server-side (service role) — src/lib/api.ts's
// getTenant/updateTenant used to hit calldesk_tenants directly from the
// browser with the anon key. That table's RLS policies check
// `auth.uid()::text = user_id`, but this app authenticates via NextAuth
// (Google), not Supabase Auth — auth.uid() is always NULL for an anon-key
// request here, so every one of those calls has been silently blocked by
// RLS since the app's first deploy (found 2026-09-06: Settings page never
// actually loaded a tenant in production). Routing through the server with
// the service-role key is the same fix already used everywhere else in
// this API surface — this table just never got the same treatment.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_tenants')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tenant: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const updates = await request.json();
  const { data, error } = await supabase
    .from('calldesk_tenants')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tenant: data });
}
