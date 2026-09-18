import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/qa/overview?days=30 — the QA "Overview" dashboard
// (trend charts + resolution rate + date range), matching Retell's own
// AI Quality Assurance tab. Same server-side aggregation pattern as
// /api/tenants/[id]/analytics (browser can't query calldesk_* directly —
// RLS blocks the anon key since this app authenticates via NextAuth, not
// Supabase Auth).
//
// "Resolved" isn't a field we track directly (Retell doesn't document their
// own exact definition either) — derived from the existing outcome enum:
// 'booked'/'answered'/'transferred' count as resolved (the call achieved a
// real purpose or was successfully handed off), 'voicemail'/'abandoned'
// don't (nothing was accomplished). Reusing outcome instead of adding a new
// LLM-scored field means this needs no re-scoring of past calls and no
// prompt change to callQa.ts.
const RESOLVED_OUTCOMES = new Set(['booked', 'answered', 'transferred']);
const VALID_DAY_WINDOWS = new Set([7, 30, 90]);

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  const requestedDays = Number(request.nextUrl.searchParams.get('days'));
  const windowDays = VALID_DAY_WINDOWS.has(requestedDays) ? requestedDays : 30;

  const now = new Date();
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  windowStart.setUTCDate(windowStart.getUTCDate() - (windowDays - 1));

  const { data, error } = await supabase
    .from('calldesk_call_logs')
    .select('created_at, outcome, qa_status, qa_score, transfer_status, transfer_wait_ms')
    .eq('tenant_id', tenantId)
    .gte('created_at', windowStart.toISOString())
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data || [];

  // Pre-seed every day so the trend charts are continuous even on
  // zero-call days, same convention as the Analytics route.
  const dayLabels: string[] = [];
  const dayTotal = new Map<string, number>();
  const dayResolved = new Map<string, number>();
  const dayScoreSum = new Map<string, number>();
  const dayScoreCount = new Map<string, number>();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(windowStart);
    d.setUTCDate(d.getUTCDate() + i);
    const key = dayKey(d);
    dayLabels.push(key);
    dayTotal.set(key, 0);
    dayResolved.set(key, 0);
    dayScoreSum.set(key, 0);
    dayScoreCount.set(key, 0);
  }

  let completedQa = 0;
  let totalScoreSum = 0;
  let totalScoreCount = 0;
  let totalResolved = 0;
  // Transfer Success Rate/Wait Time — 'answered' means the transfer target
  // actually picked up (see deriveTransferStatus for retell-engine calls,
  // /twilio/dial-status for poc-engine ones); anything else (busy/no_answer/
  // failed/canceled) counts as a failed attempt. transfer_wait_ms only
  // exists for poc-engine calls — Retell doesn't expose transfer timing, so
  // this average is implicitly poc-only whenever a tenant mixes engines.
  let transferAttempts = 0;
  let transferAnswered = 0;
  let transferWaitSum = 0;
  let transferWaitCount = 0;

  for (const row of rows) {
    const key = dayKey(new Date(row.created_at));
    if (!dayTotal.has(key)) continue;
    dayTotal.set(key, (dayTotal.get(key) || 0) + 1);

    const resolved = row.outcome ? RESOLVED_OUTCOMES.has(row.outcome) : false;
    if (resolved) {
      dayResolved.set(key, (dayResolved.get(key) || 0) + 1);
      totalResolved++;
    }

    if (row.qa_status === 'completed') completedQa++;
    if (row.qa_status === 'completed' && row.qa_score != null) {
      dayScoreSum.set(key, (dayScoreSum.get(key) || 0) + row.qa_score);
      dayScoreCount.set(key, (dayScoreCount.get(key) || 0) + 1);
      totalScoreSum += row.qa_score;
      totalScoreCount++;
    }

    if (row.transfer_status) {
      transferAttempts++;
      if (row.transfer_status === 'answered') transferAnswered++;
      if (row.transfer_wait_ms != null) {
        transferWaitSum += row.transfer_wait_ms;
        transferWaitCount++;
      }
    }
  }

  const avgScoreSeries = dayLabels.map((date) => {
    const count = dayScoreCount.get(date) || 0;
    return { date, avgScore: count > 0 ? Number(((dayScoreSum.get(date) || 0) / count).toFixed(2)) : null };
  });
  const resolutionRateSeries = dayLabels.map((date) => {
    const total = dayTotal.get(date) || 0;
    return {
      date,
      resolutionRate: total > 0 ? Number((((dayResolved.get(date) || 0) / total) * 100).toFixed(1)) : null,
    };
  });

  return NextResponse.json({
    windowDays,
    totalCalls: rows.length,
    completedQa,
    avgScore: totalScoreCount > 0 ? Number((totalScoreSum / totalScoreCount).toFixed(2)) : null,
    resolutionRate: rows.length > 0 ? Number(((totalResolved / rows.length) * 100).toFixed(1)) : null,
    avgScoreSeries,
    resolutionRateSeries,
    transferAttempts,
    transferAnswered,
    transferSuccessRate: transferAttempts > 0 ? Number(((transferAnswered / transferAttempts) * 100).toFixed(1)) : null,
    avgTransferWaitMs: transferWaitCount > 0 ? Math.round(transferWaitSum / transferWaitCount) : null,
  });
}
