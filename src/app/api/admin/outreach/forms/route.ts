import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';

// Contact-form leads: practices with no public email, where a human submits the drafted message through the
// practice's own form. The draft and its status live on the lead (signals.formOutreach).
const STATUSES = ['ready', 'submitted', 'replied', 'skipped'] as const;

export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = request.nextUrl.searchParams.get('status') || 'ready';
  const vertical = request.nextUrl.searchParams.get('vertical') || '';
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('calldesk_outreach_leads')
    .select('id, company_name, domain, location, score, product, contact_source_url, signals')
    .eq('contact_status', 'form_only')
    .like('product', 'calldesk:%')
    .not('signals->formOutreach', 'is', null)
    .eq('signals->formOutreach->>status', status)
    .order('score', { ascending: false })
    .limit(100);
  if (/^[a-z]+$/.test(vertical)) query = query.eq('product', `calldesk:${vertical}`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [] });
}

// PATCH { id, status } — mark a form lead submitted / replied / skipped (or back to ready).
export async function PATCH(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';
  const status = body.status as (typeof STATUSES)[number];
  if (!id || !STATUSES.includes(status)) return NextResponse.json({ error: 'id and a valid status are required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: lead } = await supabase.from('calldesk_outreach_leads').select('id, signals').eq('id', id).maybeSingle();
  const fo = lead?.signals?.formOutreach;
  if (!lead || !fo) return NextResponse.json({ error: 'Form lead not found' }, { status: 404 });

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    signals: { ...lead.signals, formOutreach: { ...fo, status, ...(status === 'submitted' ? { submittedAt: now } : {}) } },
    updated_at: now,
  };
  // A reply stops any further outreach to this lead, same as the email flow.
  if (status === 'replied') update.replied_at = now;
  const { error } = await supabase.from('calldesk_outreach_leads').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
