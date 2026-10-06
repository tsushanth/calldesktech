import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authenticateLink } from '@/lib/callerAuth';
import { batchDateEastern } from '@/lib/callingHours';
import { OUTCOMES, OUTCOMES_ASKING_DECISION_MAKER, WIN_OUTCOMES, decisionMakerOf } from '@/lib/callerPortal';

// GET /api/caller/admin?k=<admin token>&date=YYYY-MM-DD — the supervisor view: per caller, how many dials, how many
// answered, the outcomes logged, wins, and which answered calls have no outcome logged yet. Test calls are excluded.
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function GET(request: NextRequest) {
  const user = await authenticateLink(request.nextUrl.searchParams.get('k'));
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'This link is not valid.' }, { status: 401, headers });

  const requested = request.nextUrl.searchParams.get('date');
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : batchDateEastern();
  const db = getSupabaseAdmin();

  const { data: batch } = await db
    .from('calldesk_call_batches')
    .select('id, sip_username, phone, company_name, state, position, attempt, outcome, notes, mobile_number, text_ok, outcome_at')
    .eq('batch_date', date)
    .order('sip_username')
    .order('position');
  // Calls started on that Eastern day (the day boundary is generous: +/- a day, filtered by the batch's own phones).
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCHours(from.getUTCHours() - 6);
  const to = new Date(from.getTime() + 36 * 3600 * 1000);
  const { data: calls } = await db
    .from('calldesk_outbound_calls')
    .select('id, sip_username, to_number, status, answered, duration_seconds, reject_reason, recording_sid, outcome, started_at')
    .gte('started_at', from.toISOString())
    .lt('started_at', to.toISOString())
    .order('started_at', { ascending: false });
  const real = (calls ?? []).filter((c) => c.outcome !== 'test');

  const callers = [...new Set([...(batch ?? []).map((b) => b.sip_username), ...real.map((c) => c.sip_username)])].sort();
  const perCaller = callers.map((u) => {
    const mine = (batch ?? []).filter((b) => b.sip_username === u);
    const myCalls = real.filter((c) => c.sip_username === u);
    const dials = myCalls.filter((c) => c.status !== 'rejected');
    const answered = dials.filter((c) => c.answered);
    const outcomeCounts: Record<string, number> = {};
    for (const o of OUTCOMES) outcomeCounts[o] = mine.filter((b) => b.outcome === o).length;
    const answeredPhones = new Set(answered.map((c) => c.to_number));
    return {
      caller: u,
      batch_size: mine.length,
      dials: dials.length,
      answered: answered.length,
      avg_answered_seconds: answered.length ? Math.round(answered.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / answered.length) : 0,
      blocked: myCalls.filter((c) => c.status === 'rejected').length,
      recordings: myCalls.filter((c) => c.recording_sid).length,
      logged: mine.filter((b) => b.outcome).length,
      wins: mine.filter((b) => b.outcome && (WIN_OUTCOMES as string[]).includes(b.outcome)).length,
      outcomes: outcomeCounts,
      // People reached (a person spoke to the caller) and how many of those were the owner or decision maker, per the caller's own answer.
      people_reached: mine.filter((b) => b.outcome && (OUTCOMES_ASKING_DECISION_MAKER as string[]).includes(b.outcome)).length,
      decision_maker_reached: mine.filter((b) => b.outcome && (OUTCOMES_ASKING_DECISION_MAKER as string[]).includes(b.outcome) && decisionMakerOf(b.notes) === true).length,
      decision_maker_wins: mine.filter((b) => b.outcome && (WIN_OUTCOMES as string[]).includes(b.outcome) && decisionMakerOf(b.notes) === true).length,
      answered_not_logged: mine.filter((b) => !b.outcome && answeredPhones.has(b.phone)).length,
    };
  });

  const lastByKey = new Map<string, (typeof real)[number]>();
  for (const c of real) {
    const key = `${c.sip_username}|${c.to_number}`;
    if (!lastByKey.has(key)) lastByKey.set(key, c);
  }
  const rows = (batch ?? []).map((b) => {
    const c = lastByKey.get(`${b.sip_username}|${b.phone}`);
    return {
      caller: b.sip_username,
      position: b.position,
      company: b.company_name,
      phone: b.phone,
      state: b.state,
      attempt: b.attempt,
      call: c ? { id: c.id, status: c.status, answered: c.answered, seconds: c.duration_seconds, recorded: !!c.recording_sid, blocked: c.reject_reason } : null,
      outcome: b.outcome,
      notes: b.notes,
      mobile_number: b.mobile_number,
      text_ok: b.text_ok,
    };
  });
  return NextResponse.json({ date, callers: perCaller, rows }, { headers });
}
