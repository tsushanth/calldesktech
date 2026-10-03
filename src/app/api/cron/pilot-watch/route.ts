import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isCronRequest } from '@/lib/outreach/adminAuth';
import { runPilotWatch } from '@/lib/pilotJobs';

// POST /api/cron/pilot-watch — secret-protected (CRON_SECRET bearer, same as /api/admin/billing/report-usage; no browser session).
// ?dry=1 returns what would be sent or changed and writes nothing. Without PILOT_ALERT_EMAIL and RESEND_API_KEY nothing is sent.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  try {
    return NextResponse.json(await runPilotWatch(getSupabaseAdmin(), { dry }));
  } catch (err) {
    console.error('[pilot-watch] failed:', err);
    return NextResponse.json({ error: 'Pilot job failed' }, { status: 500 });
  }
}
