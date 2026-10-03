import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';
import { safeFetch, SsrfBlockedError } from '@/lib/safeFetch';

// GET /api/calls/[id]/recording — streams a call's audio to the browser.
// Three paths:
// 1) Retell recordings: fetch directly from the stored recording_url.
// 2) Legacy poc recordings: proxy through call-loop-poc's /recording-audio
//    (it holds the Twilio creds and the recording_url is call-loop-poc's).
// 3) New poc recordings with recording_sid: fetch directly from Twilio
//    (calldesktech now holds its own Twilio credentials).
//
// Also updates recording_downloaded_at for audit.
const RECORDING_MAX_BYTES = 100_000_000;

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
    .select('recording_url, recording_sid, voice_engine')
    .eq('id', id)
    .maybeSingle();
  if (error || !call) return NextResponse.json({ error: 'Call not found' }, { status: 404 });

  let upstream: Response;

  try {
    if (call.voice_engine === 'retell' && call.recording_url) {
      // Retell recordings are public-signed URLs. The stored URL came from a webhook, so it is treated as untrusted:
      // https only, public destinations only (safeFetch), audio content only, size capped.
      if (!call.recording_url.startsWith('https://')) return NextResponse.json({ error: 'Recording not available' }, { status: 404 });
      upstream = await safeFetch(call.recording_url, { timeoutMs: 30000, maxBytes: RECORDING_MAX_BYTES });
      const type = upstream.headers.get('content-type') || '';
      if (upstream.ok && !/^(audio\/|application\/octet-stream)/i.test(type)) {
        return NextResponse.json({ error: 'Recording not available' }, { status: 502 });
      }
    } else if (call.voice_engine === 'poc' && call.recording_url) {
      // Legacy poc path: proxy through call-loop-poc.
      const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
      const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
      if (!baseUrl || !secret) {
        return NextResponse.json({ error: 'CALL_LOOP_POC_BASE_URL/CALL_LOOP_POC_TEST_CALL_SECRET not configured' }, { status: 500 });
      }
      upstream = await fetch(`${baseUrl}/recording-audio?url=${encodeURIComponent(call.recording_url)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
    } else if (call.voice_engine === 'poc' && call.recording_sid) {
      // New poc path: fetch directly from Twilio.
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) {
        return NextResponse.json({ error: 'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not configured' }, { status: 500 });
      }
      const auth64 = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      upstream = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${call.recording_sid}.mp3`,
        { headers: { Authorization: `Basic ${auth64}` } }
      );
    } else {
      return NextResponse.json({ error: 'No recording available for this call' }, { status: 404 });
    }

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Failed to fetch recording: ${upstream.status}` }, { status: 502 });
    }

    // Audit stamp — don't block the response on this.
    supabase.from('calldesk_call_logs')
      .update({ recording_downloaded_at: new Date().toISOString() })
      .eq('id', id)
      .then(() => {}, () => {});

    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
        'Content-Disposition': `attachment; filename="call-${id}.mp3"`,
      },
    });
  } catch (err) {
    // Never echo what a blocked or failed fetch said: it would tell a tenant what lives at an internal address.
    if (err instanceof SsrfBlockedError) return NextResponse.json({ error: 'Recording not available' }, { status: 404 });
    console.error('[recording] fetch failed:', err);
    return NextResponse.json({ error: 'Failed to fetch recording' }, { status: 502 });
  }
}
