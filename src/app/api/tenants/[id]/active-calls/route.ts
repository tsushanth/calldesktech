import { NextRequest, NextResponse } from 'next/server';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/active-calls — proxies call-loop-poc's own
// GET /active-calls endpoint (see call-loop-poc/server.js) server-side, so
// the shared secret never reaches the browser. This is *live call state* —
// which of this tenant's calls are in progress right now and what flow node
// each is on — NOT audio monitoring: there is no way to listen to a call
// here, only to see that one exists and where it is in the flow.
//
// The engine is asked to filter by tenantId as well, so even the raw upstream
// response only ever contains this tenant's calls.
const CALL_LOOP_URL = process.env.CALL_LOOP_URL || 'http://localhost:8090';
const ACTIVE_CALLS_SECRET = process.env.CALL_LOOP_ACTIVE_CALLS_SECRET;

// Never cache — the whole point is a near-real-time view; the page polls this.
export const dynamic = 'force-dynamic';

type ActiveCall = {
  id: string;
  tenantId: string | null;
  phoneNumber: string | null;
  startedAt: number;
  currentNodeId: string | null;
  nodeType: string | null;
  // Live sentiment (Retell-style Live Call Monitoring parity) — null until
  // the engine has scored the first user turn of the call. See
  // call-loop-poc's CallSession._classifySentiment / activeCallSnapshot.
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  sentimentUpdatedAt: string | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;

  if (!ACTIVE_CALLS_SECRET) {
    // Misconfiguration, not a client error — surface it clearly rather than
    // silently returning "no active calls" and looking like everything's idle.
    return NextResponse.json(
      { error: 'CALL_LOOP_ACTIVE_CALLS_SECRET not configured', calls: [], count: 0 },
      { status: 500 }
    );
  }

  const url = `${CALL_LOOP_URL.replace(/\/$/, '')}/active-calls?tenantId=${encodeURIComponent(tenantId)}`;

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${ACTIVE_CALLS_SECRET}` },
      cache: 'no-store',
      // The engine is a single fast in-memory lookup — a slow response means
      // it's unreachable, not busy; fail fast so the dashboard shows an error
      // instead of hanging the poll.
      signal: AbortSignal.timeout(5000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `voice engine returned ${upstream.status}`, calls: [], count: 0 },
        { status: 502 }
      );
    }

    const data = (await upstream.json()) as {
      calls?: ActiveCall[];
      serverTime?: number;
    };
    const calls = Array.isArray(data.calls) ? data.calls : [];
    // serverTime lets the client render an accurate duration-so-far even if
    // its own clock differs from the engine's (startedAt is the engine's epoch).
    return NextResponse.json({
      calls,
      count: calls.length,
      serverTime: typeof data.serverTime === 'number' ? data.serverTime : Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { error: `could not reach voice engine: ${message}`, calls: [], count: 0 },
      { status: 502 }
    );
  }
}
