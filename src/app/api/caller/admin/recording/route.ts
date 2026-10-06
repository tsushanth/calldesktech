import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authenticateLink } from '@/lib/callerAuth';

// GET /api/caller/admin/recording?k=<admin token>&call=<call id> — plays a call's recording. The audio stays on Twilio; this
// fetches it with the account's credentials and passes it through, so no Twilio login is needed and no public URL exists.
// Admin links only. Range requests are passed on so the player can seek.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await authenticateLink(request.nextUrl.searchParams.get('k'));
  if (!user || user.role !== 'admin') return new NextResponse('This link is not valid.', { status: 401 });
  const callId = request.nextUrl.searchParams.get('call') || '';
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return new NextResponse('Bad request', { status: 400 });

  const { data } = await getSupabaseAdmin().from('calldesk_outbound_calls').select('recording_sid, recording_url').eq('id', callId).maybeSingle();
  if (!data?.recording_sid) return new NextResponse('No recording for this call.', { status: 404 });

  // The account that owns the recording is in its own URL; it must be the account we hold credentials for.
  const account = /\/Accounts\/(AC[0-9a-f]{32})\//i.exec(data.recording_url || '')?.[1] ?? process.env.TWILIO_ACCOUNT_SID;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!account || !sid || !token || account !== sid) return new NextResponse('Recording storage is not configured.', { status: 503 });

  const upstream = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/${data.recording_sid}.mp3`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, ...(request.headers.get('range') ? { Range: request.headers.get('range')! } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!upstream.ok && upstream.status !== 206) return new NextResponse('Recording not available.', { status: 502 });
  const out = new Headers({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
  for (const h of ['content-length', 'content-range', 'accept-ranges']) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
  return new NextResponse(upstream.body, { status: upstream.status, headers: out });
}
