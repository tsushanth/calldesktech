import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';

// The Worker tab of the outreach queue: what the contact-form worker delivered, newest first, with how each delivery was proven
// (the page showed a confirmation, or the company's own auto-reply arrived). Reads calldesk_form_worker_log (migration 074), a small
// table the worker and the inbound-reply webhook write to, so this never scans the leads table.
const LOG = 'calldesk_form_worker_log';

export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = () => supabase.from(LOG).select('id', { count: 'exact', head: true });
  const [rows, total, last24h, byEmail, needHuman] = await Promise.all([
    supabase
      .from(LOG)
      .select('id, created_at, lead_id, product, company_name, domain, page_url, reason, proof, confirmed_by, screenshot')
      .eq('outcome', 'submitted')
      .order('created_at', { ascending: false })
      .limit(200),
    count().eq('outcome', 'submitted'),
    count().eq('outcome', 'submitted').gte('created_at', since),
    count().eq('outcome', 'submitted').eq('proof', 'email'),
    count().neq('outcome', 'submitted').gte('created_at', since),
  ]);
  const failed = [rows, total, last24h, byEmail, needHuman].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  return NextResponse.json({
    rows: rows.data ?? [],
    counts: { total: total.count ?? 0, last24h: last24h.count ?? 0, byEmail: byEmail.count ?? 0, needHumanLast24h: needHuman.count ?? 0 },
  });
}
