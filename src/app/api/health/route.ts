import { NextResponse } from 'next/server';

// Liveness only: proves the Node server is up and routing. No database call, no secrets, no config.
// Used by the status probe. GET /api/health
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
