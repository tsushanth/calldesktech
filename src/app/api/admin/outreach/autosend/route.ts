import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isCronRequest, requireAdminSession } from '@/lib/outreach/adminAuth';
import { runAutosend } from '@/lib/outreach/autosend';

// Called every 15 minutes by the GitHub Actions cron (Authorization: Bearer CRON_SECRET).
// Sends at most one already-approved message per call; see lib/outreach/autosend.ts.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authorized = isCronRequest(request) || !!(await requireAdminSession());
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const result = await runAutosend(getSupabaseAdmin(), { dry: body?.dryRun === true });
  return NextResponse.json(result);
}
