import { NextRequest, NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/outreach/adminAuth';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/batch-calls/due/run — called every few minutes by the scheduled-
// batch-calls GitHub Actions cron. Finds every 'pending' batch whose
// scheduled_at has passed and triggers it via the real run route (so all the
// existing from-number resolution, rate limiting, and per-target dial logic
// stays in exactly one place — this endpoint is just what decides WHEN to
// call it). A batch outside its call_time_window is skipped this pass; the
// run route itself re-checks the window and returns 409, which this treats
// as "try again next tick," not a failure.
export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: due, error } = await supabase
    .from('calldesk_batch_calls')
    .select('id')
    .eq('status', 'pending')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const origin = new URL(request.url).origin;
  const results: { batchId: string; ok: boolean; detail: unknown }[] = [];
  for (const batch of due || []) {
    try {
      const res = await fetch(`${origin}/api/batch-calls/${batch.id}/run`, {
        method: 'POST',
        headers: { Authorization: request.headers.get('authorization') || '' },
      });
      results.push({ batchId: batch.id, ok: res.ok, detail: await res.json().catch(() => null) });
    } catch (err) {
      results.push({ batchId: batch.id, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ checked: (due || []).length, results });
}
