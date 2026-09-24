import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import {
  FORM_OUTREACH_STATUSES,
  canApplyAction,
  canSetStatus,
  type FormOutreachAction,
  type FormOutreachStatus,
} from '@/lib/outreach/formSubmit';

// Contact-form leads: practices with no public email, where the drafted message goes through the
// practice's own form. The draft and its status live on the lead (signals.formOutreach).
//
// A submission NEVER happens without a human: the only way into 'queued' (the one status the
// form-submit worker picks up) is the "Submit for me" click, which sends { action: 'queue' } here.
// Everything else on this route is bookkeeping for the human doing it by hand.

export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requested = request.nextUrl.searchParams.get('status') || 'ready';
  if (!FORM_OUTREACH_STATUSES.includes(requested as FormOutreachStatus)) {
    return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
  }
  const vertical = request.nextUrl.searchParams.get('vertical') || '';
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('calldesk_outreach_leads')
    .select('id, company_name, domain, location, score, product, contact_source_url, signals')
    .eq('contact_status', 'form_only')
    .like('product', 'calldesk:%')
    .not('signals->formOutreach', 'is', null)
    .eq('signals->formOutreach->>status', requested)
    .order('score', { ascending: false })
    .limit(100);
  if (/^[a-z]+$/.test(vertical)) query = query.eq('product', `calldesk:${vertical}`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [], counts: await statusCounts(supabase, vertical) });
}

// A small summary line for the forms tab: how many are waiting on a human, how many went out today.
// Counted in code from one bounded read rather than one count query per status.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function statusCounts(supabase: any, vertical: string): Promise<Record<string, number>> {
  let q = supabase
    .from('calldesk_outreach_leads')
    .select('signals')
    .eq('contact_status', 'form_only')
    .like('product', 'calldesk:%')
    .not('signals->formOutreach', 'is', null)
    .limit(2000);
  if (/^[a-z]+$/.test(vertical)) q = q.eq('product', `calldesk:${vertical}`);
  const { data } = await q;
  const counts: Record<string, number> = { submittedToday: 0 };
  const today = new Date().toISOString().slice(0, 10);
  for (const row of (data ?? []) as { signals?: { formOutreach?: { status?: string; submittedAt?: string } } }[]) {
    const fo = row.signals?.formOutreach;
    if (!fo?.status) continue;
    counts[fo.status] = (counts[fo.status] ?? 0) + 1;
    if (fo.status === 'submitted' && fo.submittedAt?.slice(0, 10) === today) counts.submittedToday++;
  }
  return counts;
}

// PATCH { id, status } — a human marks a form lead submitted / replied / skipped (or back to ready).
// PATCH { id, action: 'queue' }  — "Submit for me": hands the lead to the worker (ready|needs_manual -> queued).
// PATCH { id, action: 'retry' }  — re-queue an attempt that failed or needed a human (failed|needs_manual -> queued).
export async function PATCH(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';
  const action = typeof body.action === 'string' ? (body.action as FormOutreachAction) : null;
  const status = typeof body.status === 'string' ? (body.status as FormOutreachStatus) : null;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (action && !['queue', 'retry'].includes(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  if (!action && (!status || !FORM_OUTREACH_STATUSES.includes(status))) {
    return NextResponse.json({ error: 'id and a valid status or action are required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: lead } = await supabase.from('calldesk_outreach_leads').select('id, signals').eq('id', id).maybeSingle();
  const fo = lead?.signals?.formOutreach;
  if (!lead || !fo) return NextResponse.json({ error: 'Form lead not found' }, { status: 404 });

  const current = fo.status as FormOutreachStatus;
  const now = new Date().toISOString();
  let next: Record<string, unknown>;

  if (action) {
    if (!canApplyAction(action, current)) {
      return NextResponse.json({ error: `Cannot ${action} a lead that is ${current}` }, { status: 409 });
    }
    // Queueing clears the previous refusal so the card reads cleanly, but keeps attempts[].
    next = { ...fo, status: 'queued', queuedAt: now, queuedBy: admin.email, reason: undefined, error: undefined };
  } else {
    if (!canSetStatus(status!, current)) {
      return NextResponse.json({ error: `Cannot set ${status} on a lead that is ${current}` }, { status: 409 });
    }
    next = { ...fo, status, ...(status === 'submitted' ? { submittedAt: now } : {}) };
  }

  const update: Record<string, unknown> = {
    signals: { ...lead.signals, formOutreach: next },
    updated_at: now,
  };
  // A reply stops any further outreach to this lead, same as the email flow.
  if (status === 'replied') update.replied_at = now;
  const { error } = await supabase.from('calldesk_outreach_leads').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status: next.status });
}
