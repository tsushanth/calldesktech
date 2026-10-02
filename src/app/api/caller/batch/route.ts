import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authenticateLink } from '@/lib/callerAuth';
import { batchDateEastern, checkCallingHours, localTimeLabel, startOfEasternDay } from '@/lib/callingHours';
import { WIN_OUTCOMES } from '@/lib/callerPortal';

// GET /api/caller/batch?k=<private token> — the signed-in caller's numbers for today (US Eastern date), each with
// the business's local time, whether it is a legal time to call, what the line recorded for the last dial of
// that number, and the outcome the caller has logged so far.
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function GET(request: NextRequest) {
  const user = await authenticateLink(request.nextUrl.searchParams.get('k'));
  if (!user) return NextResponse.json({ error: 'This link is not valid.' }, { status: 401, headers });

  const db = getSupabaseAdmin();
  const date = batchDateEastern();
  const { data: rows, error } = await db
    .from('calldesk_call_batches')
    .select('id, phone, company_name, state, position, attempt, outcome, notes, mobile_number, text_ok, outcome_at')
    .eq('batch_date', date)
    .eq('sip_username', user.sip_username)
    .order('position');
  if (error) return NextResponse.json({ error: 'Could not load your batch.' }, { status: 500, headers });

  const { data: calls } = await db
    .from('calldesk_outbound_calls')
    .select('to_number, status, answered, duration_seconds, started_at, reject_reason')
    .eq('sip_username', user.sip_username)
    .gte('started_at', startOfEasternDay().toISOString())
    .order('started_at', { ascending: false });
  const lastCall = new Map<string, { status: string; answered: boolean | null; duration_seconds: number | null; reject_reason: string | null }>();
  for (const c of calls ?? []) if (!lastCall.has(c.to_number)) lastCall.set(c.to_number, c);

  const now = new Date();
  const out = (rows ?? []).map((r) => {
    const hours = checkCallingHours(r.state, now);
    const call = lastCall.get(r.phone);
    return {
      id: r.id,
      phone: r.phone,
      company_name: r.company_name,
      state: r.state,
      position: r.position,
      attempt: r.attempt,
      local_time: localTimeLabel(r.state, now),
      can_call_now: hours.ok,
      hours_reason: hours.ok ? null : hours.reason,
      last_call: call ? { status: call.status, answered: call.answered, seconds: call.duration_seconds, blocked: call.reject_reason } : null,
      outcome: r.outcome,
      notes: r.notes,
      mobile_number: r.mobile_number,
      text_ok: r.text_ok,
    };
  });
  const summary = {
    total: out.length,
    dialed: out.filter((r) => r.last_call && !r.last_call.blocked).length,
    logged: out.filter((r) => r.outcome).length,
    wins: out.filter((r) => r.outcome && (WIN_OUTCOMES as string[]).includes(r.outcome)).length,
  };
  return NextResponse.json({ caller: { username: user.sip_username, name: user.display_name, role: user.role }, date, summary, rows: out }, { headers });
}
