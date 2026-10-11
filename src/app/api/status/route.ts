import { NextResponse } from 'next/server';
import { getStatusSnapshot, toPublicJson } from '@/lib/status/store';

// Public, unauthenticated: current state plus 90 daily buckets per component. No internal details.
// GET /api/status
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(toPublicJson(await getStatusSnapshot()), {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (err) {
    console.error('[status] read failed:', err);
    return NextResponse.json({ error: 'Status data is temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
