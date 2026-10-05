import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isCronRequest } from '@/lib/outreach/adminAuth';
import { runCallIssuesDigest } from '@/lib/callIssuesDigest';

// POST /api/cron/call-issues-digest — CRON_SECRET bearer. ?dry=1 returns the digest and sends nothing. Quiet days send nothing.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  try {
    return NextResponse.json(await runCallIssuesDigest(getSupabaseAdmin(), { dry }));
  } catch (err) {
    console.error('[call-issues-digest] failed:', err);
    return NextResponse.json({ error: 'Digest failed' }, { status: 500 });
  }
}
