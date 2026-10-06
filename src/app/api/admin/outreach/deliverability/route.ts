import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { computeDeliverability, type MailEvent, type SentMessage } from '@/lib/outreach/deliverability';
import { dailyCap, sentTodayCount } from '@/lib/outreach/sender';

export const dynamic = 'force-dynamic';

const PAGE = 1000;
const MAX_ROWS = 50_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// GET /api/admin/outreach/deliverability: sends and bounce/complaint outcome per product and per autosend lane.
export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  try {
    const messages = await fetchAll<SentMessage>(() =>
      supabase.from('calldesk_outreach_messages').select('id, product, sent_at').eq('status', 'sent').not('sent_at', 'is', null).order('sent_at', { ascending: false }));
    const events = await fetchAll<MailEvent>(() =>
      supabase.from('calldesk_outreach_email_events').select('message_id, event, detail').in('event', ['delivered', 'bounced', 'complained', 'delivery_delayed']).order('occurred_at', { ascending: false }));
    const maxBounce = Number(process.env.OUTREACH_AUTOSEND_MAX_BOUNCE) || 0.05;
    const result = computeDeliverability(messages, events, { maxBounce });
    const caps = {
      calldesk: { sentToday: await sentTodayCount(supabase, 'calldesk'), cap: dailyCap('calldesk') },
      kk: { sentToday: await sentTodayCount(supabase, 'kreativekoala'), cap: dailyCap('kreativekoala') },
      readaloud: { sentToday: await sentTodayCount(supabase, 'readaloud:api'), cap: dailyCap('readaloud:api') },
    };
    const queued = await supabase.from('calldesk_outreach_messages').select('product').eq('status', 'approved').limit(5000);
    const approved: Record<string, number> = {};
    for (const r of (queued.data ?? []) as { product: string | null }[]) approved[r.product ?? 'calldesk'] = (approved[r.product ?? 'calldesk'] ?? 0) + 1;
    // Engagement per product over 7 days: who opened what the email linked to, and who used the trial form. Bots are never stored.
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const engagement: Record<string, { deckViews: number; sampleViews: number; tryViews: number; trySubmissions: number; replies: number }> = {};
    const eng = (p: string | null) => (engagement[p ?? 'calldesk'] ??= { deckViews: 0, sampleViews: 0, tryViews: 0, trySubmissions: 0, replies: 0 });
    const deck = await supabase.from('calldesk_outreach_deck_events').select('product, event').eq('is_bot', false).gte('created_at', since7).limit(20000);
    for (const r of (deck.data ?? []) as { product: string | null; event: string }[]) { if (r.event === 'try_view') eng(r.product).tryViews++; else eng(r.product).deckViews++; }
    const smp = await supabase.from('calldesk_outreach_sample_events').select('product, event').eq('is_bot', false).eq('event', 'view').gte('created_at', since7).limit(20000);
    for (const r of (smp.data ?? []) as { product: string | null }[]) eng(r.product).sampleViews++;
    const cons = await supabase.from('calldesk_sms_consents').select('product').gte('created_at', since7).limit(20000);
    for (const r of (cons.data ?? []) as { product: string | null }[]) eng(r.product).trySubmissions++;
    const rep = await supabase.from('calldesk_outreach_leads').select('product').gte('replied_at', since7).limit(20000);
    for (const r of (rep.data ?? []) as { product: string | null }[]) eng(r.product).replies++;
    return NextResponse.json({ generatedAt: new Date().toISOString(), maxBounce, caps, approved, engagement, ...result });
  } catch (err) {
    console.warn('[admin/deliverability]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Deliverability data unavailable' }, { status: 500 });
  }
}
