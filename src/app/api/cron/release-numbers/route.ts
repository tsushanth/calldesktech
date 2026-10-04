import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isCronRequest } from '@/lib/outreach/adminAuth';
import { runNumberRelease } from '@/lib/numberRelease';

// POST /api/cron/release-numbers — secret-protected (CRON_SECRET bearer, like the other cron routes). Releases the purchased numbers of
// cancelled tenants once their grace period (calldesk_phone_numbers.release_after) has passed. ?dry=1 reports and changes nothing.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  try {
    return NextResponse.json(await runNumberRelease(getSupabaseAdmin(), { dry }));
  } catch (err) {
    console.error('[release-numbers] failed:', err);
    return NextResponse.json({ error: 'Number release failed' }, { status: 500 });
  }
}
