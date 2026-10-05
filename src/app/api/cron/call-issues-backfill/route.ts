import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isCronRequest } from '@/lib/outreach/adminAuth';
import { backfillCallIssues } from '@/lib/callIssues';

// POST /api/cron/call-issues-backfill - secret-protected (CRON_SECRET bearer, no browser session). Scans up to 200 finished calls from
// the last 14 days that have no analysis.issues yet and stores the deterministic issue findings on them. ?dry=1 reports what it would
// find and writes nothing. Counts only in the response: no transcripts or customer data.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  try {
    return NextResponse.json(await backfillCallIssues(getSupabaseAdmin(), { dry, limit: 200 }));
  } catch (err) {
    console.error('[call-issues-backfill] failed:', err);
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}
