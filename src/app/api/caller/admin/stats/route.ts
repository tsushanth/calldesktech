import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authenticateLink } from '@/lib/callerAuth';
import { batchDateEastern } from '@/lib/callingHours';
import { aggregate, type BatchRow, type CallRow } from '@/lib/callerStats';

// GET /api/caller/admin/stats?k=<admin token>&days=7 — the supervisor trend view: per day, per segment (what kind of company was
// called) and per hour of the day (US Eastern), for the last N days. Test calls are excluded. Admin links only.
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function GET(request: NextRequest) {
  const user = await authenticateLink(request.nextUrl.searchParams.get('k'));
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'This link is not valid.' }, { status: 401, headers });

  const days = Math.min(30, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 7));
  const db = getSupabaseAdmin();
  const today = batchDateEastern();
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const sinceDate = since.toISOString().slice(0, 10);
  const callsFrom = new Date(`${sinceDate}T00:00:00Z`);
  callsFrom.setUTCHours(callsFrom.getUTCHours() - 6);

  const { data: batch } = await db.from('calldesk_call_batches')
    .select('batch_date, sip_username, phone, outcome, notes, lead_id').gte('batch_date', sinceDate).limit(5000);
  const { data: calls } = await db.from('calldesk_outbound_calls')
    .select('sip_username, to_number, status, answered, duration_seconds, started_at, outcome').gte('started_at', callsFrom.toISOString()).limit(8000);

  const leadIds = [...new Set(((batch ?? []) as BatchRow[]).map((b) => b.lead_id).filter((x): x is string => !!x))];
  const productByLead = new Map<string, string>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await db.from('calldesk_outreach_leads').select('id, product').in('id', leadIds.slice(i, i + 200));
    for (const l of (data ?? []) as { id: string; product: string }[]) productByLead.set(l.id, l.product);
  }

  const result = aggregate((batch ?? []) as BatchRow[], (calls ?? []) as CallRow[], productByLead);
  return NextResponse.json({ days: requestedDays(result.days, sinceDate), segments: result.segments, hours: result.hours, range: { from: sinceDate, to: today } }, { headers });
}

// Calls near the window edge can add a day before `since`; keep only the days asked for.
const requestedDays = <T extends { label: string }>(rows: T[], since: string) => rows.filter((r) => r.label >= since);
