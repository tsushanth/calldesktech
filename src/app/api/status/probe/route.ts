import { NextRequest, NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/outreach/adminAuth';
import { runAllProbes } from '@/lib/status/probe';
import { saveProbeResults } from '@/lib/status/store';

// POST /api/status/probe -- secret-protected (CRON_SECRET bearer, same pattern as /api/cron/*).
// Runs every probe in parallel and stores the results. Called every minute by the scheduler in
// scripts/status-probe-worker. A failing component is a normal result (stored as 'down'); only a
// failure to store returns 500.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const results = await runAllProbes();
  try {
    await saveProbeResults(results);
  } catch (err) {
    console.error('[status-probe] store failed:', err);
    return NextResponse.json({ error: 'Could not store probe results' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, results: results.map(({ component, status, http_code, latency_ms }) => ({ component, status, http_code, latency_ms })) });
}
