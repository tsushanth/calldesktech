import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { capResetLabel, dailyCap, sentTodayCount } from '@/lib/outreach/sender';

// GET /api/admin/outreach/messages?status=draft — the review queue, with the
// lead's name/domain/score joined on for context.
export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = request.nextUrl.searchParams.get('status') || 'draft';
  const product = request.nextUrl.searchParams.get('product') || 'calldesk';
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_outreach_messages')
    .select('*, lead:calldesk_outreach_leads(company_name, domain, score, tier, contact_source_url)')
    .eq('status', status)
    .eq('product', product)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data, sentToday: await sentTodayCount(supabase, product), cap: dailyCap(product), resets: capResetLabel() });
}
