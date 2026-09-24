import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { getPublishedSample } from '@/lib/outreach/samples';
import { capResetLabel, dailyCap, sentTodayCount, startOfDayInTz } from '@/lib/outreach/sender';

// GET /api/admin/outreach/messages?status=draft — the review queue, with the
// lead's name/domain/score joined on for context.
export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = request.nextUrl.searchParams.get('status') || 'draft';
  const product = request.nextUrl.searchParams.get('product') || 'calldesk';
  const vertical = request.nextUrl.searchParams.get('vertical') || '';
  const supabase = getSupabaseAdmin();
  // 'calldesk' groups the base product and every vertical (calldesk:<vertical>); optionally narrowed to one vertical.
  const grouped = product === 'calldesk';
  let query = supabase
    .from('calldesk_outreach_messages')
    .select('*, lead:calldesk_outreach_leads(company_name, domain, score, tier, contact_source_url, replied_at)')
    .eq('status', status);
  if (!grouped) query = query.eq('product', product);
  else if (/^[a-z]+$/.test(vertical)) query = query.eq('product', `calldesk:${vertical}`);
  else query = query.or('product.eq.calldesk,product.like.calldesk:%');
  const { data, error } = await query
    .order('step', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // One cheap lookup per product (not per message); missing table degrades to null.
  const sampleTitles: Record<string, string | null> = {};
  const products = new Set<string>(((data ?? []) as { product?: string | null }[]).map((m) => m.product || 'calldesk'));
  for (const pr of products) {
    try {
      const sample = pr.startsWith('calldesk:') ? await getPublishedSample(supabase, pr) : null;
      sampleTitles[pr] = sample ? sample.title || 'Sample call' : null;
    } catch {
      sampleTitles[pr] = null;
    }
  }
  const sampleTitle = grouped ? null : sampleTitles[product] ?? null;
  let sentToday: number;
  if (grouped) {
    const { count } = await supabase
      .from('calldesk_outreach_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .or('product.eq.calldesk,product.like.calldesk:%')
      .gte('sent_at', startOfDayInTz().toISOString());
    sentToday = count ?? 0;
  } else {
    sentToday = await sentTodayCount(supabase, product);
  }
  return NextResponse.json({ messages: data, sampleTitle, sampleTitles, sentToday, cap: dailyCap(product), resets: capResetLabel() });
}
