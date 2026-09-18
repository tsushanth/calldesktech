import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';

// GET /api/calls/[id]/recording — streams a call's audio to the browser.
// Neither engine's recording URL can be linked to directly from an <audio
// src>: a poc-engine (Twilio) recording requires HTTP Basic Auth with the
// account's SID/token, which obviously can't be handed to the client, so
// that fetch is proxied through call-loop-poc's own /recording-audio (it
// holds those creds, not us). Retell recordings are fetched here directly —
// simpler to route both through one server-side endpoint than to special-
// case the client for one engine vs the other.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_call_logs', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: call, error } = await supabase
    .from('calldesk_call_logs')
    .select('recording_url, voice_engine')
    .eq('id', id)
    .maybeSingle();
  if (error || !call) return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  if (!call.recording_url) return NextResponse.json({ error: 'No recording for this call' }, { status: 404 });

  try {
    let upstream: Response;
    if (call.voice_engine === 'poc') {
      const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
      const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
      if (!baseUrl || !secret) {
        return NextResponse.json({ error: 'CALL_LOOP_POC_BASE_URL/CALL_LOOP_POC_TEST_CALL_SECRET not configured' }, { status: 500 });
      }
      upstream = await fetch(`${baseUrl}/recording-audio?url=${encodeURIComponent(call.recording_url)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
    } else {
      upstream = await fetch(call.recording_url);
    }
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Failed to fetch recording' }, { status: 502 });
    }
    return new NextResponse(upstream.body, {
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch recording';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
