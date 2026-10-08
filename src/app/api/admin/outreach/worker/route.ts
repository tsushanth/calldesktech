import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';

// The Worker tab of the outreach queue: every attempt of the contact-form worker, newest first, with its outcome (delivered, needs a human,
// failed), the reason, how a delivery was proven (the page showed a confirmation, or the company's own auto-reply arrived), and where the lead
// stands NOW (a human may have finished it since). Reads calldesk_form_worker_log (migration 074), a small table the worker and the
// inbound-reply webhook write to; the current status is looked up by id for just the rows returned, so this never scans the leads table.
const LOG = 'calldesk_form_worker_log';
const OUTCOMES = ['submitted', 'needs_manual', 'failed'] as const;
type Outcome = (typeof OUTCOMES)[number];

export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wanted = request.nextUrl.searchParams.get('outcome') || 'all';
  if (wanted !== 'all' && !OUTCOMES.includes(wanted as Outcome)) return NextResponse.json({ error: 'Unknown outcome' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = (outcome: Outcome) => supabase.from(LOG).select('id', { count: 'exact', head: true }).eq('outcome', outcome);

  let list = supabase
    .from(LOG)
    .select('id, created_at, lead_id, product, company_name, domain, page_url, outcome, reason, proof, confirmed_by, screenshot')
    .order('created_at', { ascending: false })
    .limit(300);
  if (wanted !== 'all') list = list.eq('outcome', wanted);

  const [rows, ...counts] = await Promise.all([
    list,
    ...OUTCOMES.map((o) => count(o)),
    ...OUTCOMES.map((o) => count(o).gte('created_at', since)),
    count('submitted').eq('proof', 'email'),
  ]);
  const failed = [rows, ...counts].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  const n = (i: number) => counts[i]?.count ?? 0;

  // Where each lead stands now, for the rows shown.
  const ids = Array.from(new Set((rows.data ?? []).map((r: { lead_id: string | null }) => r.lead_id).filter((x: string | null): x is string => !!x)));
  const current: Record<string, string | null> = {};
  if (ids.length) {
    const { data } = await supabase.from('calldesk_outreach_leads').select('id, fo_status:signals->formOutreach->>status').in('id', ids);
    for (const l of (data ?? []) as { id: string; fo_status: string | null }[]) current[l.id] = l.fo_status;
  }

  return NextResponse.json({
    rows: (rows.data ?? []).map((r: { lead_id: string | null }) => ({ ...r, lead_status: r.lead_id ? current[r.lead_id] ?? null : null })),
    counts: {
      all: { attempts: n(0) + n(1) + n(2), delivered: n(0), needsManual: n(1), failed: n(2) },
      last24h: { attempts: n(3) + n(4) + n(5), delivered: n(3), needsManual: n(4), failed: n(5) },
      byEmail: n(6),
    },
  });
}
