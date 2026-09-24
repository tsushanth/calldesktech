import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { computeSampleStats, type StatsEvent, type StatsMessage } from '@/lib/outreach/sampleEvents';

export const dynamic = 'force-dynamic';

// GET /api/admin/outreach/samples/stats — per product x variant funnel.
// Tolerates the sample tables/columns not existing yet (returns empty stats).
export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  try {
    const sel = (cols: string) =>
      supabase.from('calldesk_outreach_messages').select(cols).eq('status', 'sent').limit(5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: { data: any; error: any } = await sel('id, product, variant, sample_id, lead:calldesk_outreach_leads(replied_at)');
    if (res.error) res = await sel('id, product, lead:calldesk_outreach_leads(replied_at)');
    if (res.error) return NextResponse.json({ stats: [], note: 'messages unavailable' });

    const rawMsgs = (res.data ?? []) as Array<{
      id: string; product?: string | null; variant?: string | null; sample_id?: string | null;
      lead?: { replied_at?: string | null } | Array<{ replied_at?: string | null }> | null;
    }>;
    const messages: StatsMessage[] = rawMsgs.map((m) => {
      const lead = Array.isArray(m.lead) ? m.lead[0] : m.lead;
      return { id: m.id, product: m.product ?? null, variant: m.variant ?? null, sample_id: m.sample_id ?? null, replied: !!lead?.replied_at };
    });

    let events: StatsEvent[] = [];
    const evRes = await supabase.from('calldesk_outreach_sample_events').select('message_id, event, is_bot').eq('is_bot', false).limit(50000);
    if (!evRes.error) events = (evRes.data ?? []) as StatsEvent[];

    const sampleProducts: Record<string, string> = {};
    const sRes = await supabase.from('calldesk_outreach_samples').select('id, product');
    if (!sRes.error) for (const s of (sRes.data ?? []) as Array<{ id: string; product: string }>) sampleProducts[s.id] = s.product;

    return NextResponse.json({ stats: computeSampleStats(messages, events, sampleProducts) });
  } catch (err) {
    console.warn('[admin/samples/stats]', err instanceof Error ? err.message : err);
    return NextResponse.json({ stats: [], note: 'stats unavailable' });
  }
}
