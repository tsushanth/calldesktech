import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { recordSampleEvent, isClientEvent } from '@/lib/outreach/sampleEvents';
import { supabaseEventDeps } from '@/lib/outreach/sampleEventsDb';

export const dynamic = 'force-dynamic';

// POST /api/samples/event  {t, event: 'play'|'complete'}
// Public, first-party. Always answers 204 regardless of outcome (no detail leaks).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { t?: unknown; event?: unknown } | null;
    if (body && isClientEvent(body.event)) {
      await recordSampleEvent(supabaseEventDeps(getSupabaseAdmin()), {
        token: body.t,
        event: body.event,
        userAgent: request.headers.get('user-agent'),
      });
    }
  } catch (err) {
    console.warn('[api/samples/event]', err instanceof Error ? err.message : err);
  }
  return new NextResponse(null, { status: 204 });
}
