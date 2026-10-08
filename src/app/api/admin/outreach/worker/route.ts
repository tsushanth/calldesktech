import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { canSetStatus, type FormOutreachStatus } from '@/lib/outreach/formSubmit';

// The Worker tab of the outreach queue: every attempt of the contact-form worker, newest first, with its outcome (delivered, needs a human,
// failed), the reason, how a delivery was proven (the page showed a confirmation, or the company's own auto-reply arrived), where the lead
// stands NOW, and for the ones that need a human the message to paste. Reads calldesk_form_worker_log (migrations 074, 075), a small table the
// worker and the inbound-reply webhook write to; lead details are looked up by id for just the rows returned, so this never scans the leads table.
//
// PATCH { id }: the human's "Done". The attempt rows of that lead that needed a human are dismissed (they leave "needs you" and "failed" and
// their counts, and stay under "all tried" as done by you) and the lead is marked submitted, so the worker never retries it.
const LOG = 'calldesk_form_worker_log';
const LEADS = 'calldesk_outreach_leads';
const OUTCOMES = ['submitted', 'needs_manual', 'failed'] as const;
type Outcome = (typeof OUTCOMES)[number];

export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wanted = request.nextUrl.searchParams.get('outcome') || 'all';
  if (wanted !== 'all' && !OUTCOMES.includes(wanted as Outcome)) return NextResponse.json({ error: 'Unknown outcome' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  // Delivered counts as is. Needs-you and failed count only what a human has not finished.
  const count = (outcome: Outcome) => {
    const q = supabase.from(LOG).select('id', { count: 'exact', head: true }).eq('outcome', outcome);
    return outcome === 'submitted' ? q : q.is('dismissed_at', null);
  };
  const done = () => supabase.from(LOG).select('id', { count: 'exact', head: true }).not('dismissed_at', 'is', null);

  let list = supabase
    .from(LOG)
    .select('id, created_at, lead_id, product, company_name, domain, page_url, outcome, reason, proof, confirmed_by, screenshot, dismissed_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (wanted === 'submitted') list = list.eq('outcome', 'submitted');
  else if (wanted !== 'all') list = list.eq('outcome', wanted).is('dismissed_at', null);

  const [rows, ...counts] = await Promise.all([
    list,
    ...OUTCOMES.map((o) => count(o)),
    ...OUTCOMES.map((o) => count(o).gte('created_at', since)),
    count('submitted').eq('proof', 'email'),
    done(),
  ]);
  const failed = [rows, ...counts].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  const n = (i: number) => counts[i]?.count ?? 0;

  // Where each lead stands now, and the message to paste for the ones that need a human.
  const data = rows.data ?? [];
  const ids = Array.from(new Set(data.map((r: { lead_id: string | null }) => r.lead_id).filter((x: string | null): x is string => !!x)));
  const current: Record<string, { status: string | null; subject: string | null; body: string | null }> = {};
  if (ids.length) {
    const { data: leads } = await supabase
      .from(LEADS)
      .select('id, fo_status:signals->formOutreach->>status, fo_subject:signals->formOutreach->>subject, fo_body:signals->formOutreach->>body')
      .in('id', ids);
    for (const l of (leads ?? []) as { id: string; fo_status: string | null; fo_subject: string | null; fo_body: string | null }[]) {
      current[l.id] = { status: l.fo_status, subject: l.fo_subject, body: l.fo_body };
    }
  }

  return NextResponse.json({
    rows: data.map((r: { lead_id: string | null; outcome: Outcome; dismissed_at: string | null }) => {
      const lead = r.lead_id ? current[r.lead_id] : undefined;
      const needsHuman = r.outcome !== 'submitted' && !r.dismissed_at;
      return { ...r, lead_status: lead?.status ?? null, message: needsHuman && lead?.body ? { subject: lead.subject, body: lead.body } : null };
    }),
    counts: {
      all: { attempts: n(0) + n(1) + n(2) + n(7), delivered: n(0), needsManual: n(1), failed: n(2), done: n(7) },
      last24h: { attempts: n(3) + n(4) + n(5), delivered: n(3), needsManual: n(4), failed: n(5) },
      byEmail: n(6),
    },
  });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase.from(LOG).select('id, lead_id, outcome').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  if (row.outcome === 'submitted') return NextResponse.json({ error: 'A delivered form needs nothing from you' }, { status: 409 });

  const now = new Date().toISOString();
  if (row.lead_id) {
    const { data: lead } = await supabase.from(LEADS).select('id, signals').eq('id', row.lead_id).maybeSingle();
    const fo = lead?.signals?.formOutreach;
    if (lead && fo) {
      const current = fo.status as FormOutreachStatus;
      // Already finished (by the worker, a reply, or an earlier Done): nothing to change on the lead. In flight: do not pull it from under the worker.
      if (current !== 'submitted' && current !== 'replied') {
        if (!canSetStatus('submitted', current)) return NextResponse.json({ error: `Cannot mark a lead that is ${current}` }, { status: 409 });
        const next = { ...fo, status: 'submitted', submittedAt: now, doneManuallyBy: admin.email, reason: undefined, error: undefined };
        const { error } = await supabase.from(LEADS).update({ signals: { ...lead.signals, formOutreach: next }, updated_at: now }).eq('id', lead.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  // Dismiss every open attempt of the lead that needed a human (or just this one when the lead is gone).
  let dismiss = supabase.from(LOG).update({ dismissed_at: now, dismissed_by: admin.email }).is('dismissed_at', null).neq('outcome', 'submitted');
  dismiss = row.lead_id ? dismiss.eq('lead_id', row.lead_id) : dismiss.eq('id', id);
  const { error: dismissError } = await dismiss;
  if (dismissError) return NextResponse.json({ error: dismissError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
