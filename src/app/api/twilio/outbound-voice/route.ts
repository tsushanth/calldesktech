import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyTwilioSignature } from '@/lib/webhookAuth';
import { buildDialTwiml, buildRejectTwiml, decideDial, normalizeNanp, parseTestNumbers, sipUser } from '@/lib/outboundCalling';

// POST /api/twilio/outbound-voice — the Voice URL of the outbound-sales SIP domain. A human caller dials
// a number from a softphone, Twilio asks us what to do with the call, and we answer with a <Dial> from
// that caller's own caller ID, or refuse. Every attempt, placed or refused, is written to
// calldesk_outbound_calls so the log never depends on the caller remembering to record it.
//
// Fail-closed throughout: no signature token configured -> 401; unknown/disabled caller, an invalid or
// do-not-call number, a number outside our lead list, or a caller over the daily cap -> the call is
// refused with a spoken reason. Set OUTBOUND_REQUIRE_LEAD=false to allow numbers that are not leads.
//
// Caller identity is the user part of the SIP From header; with one credential per person (the
// setup here) that is the username the softphone authenticated with.

const xml = (body: string, status = 200) => new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml' } });

function publicUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');
  return `${base}${path}`;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === 'string') params[k] = v; });

  const verified = verifyTwilioSignature(publicUrl('/api/twilio/outbound-voice'), params, request.headers.get('x-twilio-signature'), {
    authToken: process.env.TWILIO_OUTBOUND_AUTH_TOKEN,
    failClosed: true,
  });
  if (!verified.ok) {
    console.warn('[outbound-voice] rejected request:', verified.reason);
    return new NextResponse('Forbidden', { status: 401 });
  }

  const callSid = params.CallSid || null;
  const username = sipUser(params.From || '');
  const dialed = sipUser(params.To || '') ?? params.To ?? null;
  const toE164 = dialed ? normalizeNanp(dialed) : null;

  const supabase = getSupabaseAdmin();
  const caller = username
    ? (await supabase.from('calldesk_outbound_callers').select('caller_id, enabled').eq('sip_username', username).maybeSingle()).data
    : null;

  let leadId: string | null = null;
  let doNotCall = false;
  let dialsToday = 0;
  if (toE164) {
    leadId = (await supabase.from('calldesk_outreach_leads').select('id').eq('phone', toE164).limit(1).maybeSingle()).data?.id ?? null;
    doNotCall = !!(await supabase.from('calldesk_do_not_call').select('phone').eq('phone', toE164).maybeSingle()).data;
  }
  if (username) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('calldesk_outbound_calls')
      .select('id', { count: 'exact', head: true })
      .eq('sip_username', username)
      .neq('status', 'rejected')
      .gte('started_at', startOfDay.toISOString());
    dialsToday = count ?? 0;
  }

  const decision = decideDial({
    sipUsername: username,
    to: dialed,
    caller: caller ?? null,
    leadId,
    doNotCall,
    isTestNumber: !!toE164 && parseTestNumbers(process.env.OUTBOUND_TEST_NUMBERS).has(toE164),
    requireLead: process.env.OUTBOUND_REQUIRE_LEAD !== 'false',
    dialsToday,
    maxDialsPerDay: Number(process.env.OUTBOUND_MAX_DIALS_PER_DAY) || 400,
  });

  if (!decision.ok) {
    await supabase.from('calldesk_outbound_calls').insert({
      call_sid: callSid,
      sip_username: username ?? 'unknown',
      lead_id: leadId,
      to_number: toE164 ?? dialed ?? 'unknown',
      caller_id: caller?.caller_id ?? 'none',
      status: 'rejected',
      reject_reason: decision.reason,
      ended_at: new Date().toISOString(),
    });
    return xml(buildRejectTwiml(decision.spoken));
  }

  await supabase.from('calldesk_outbound_calls').insert({
    call_sid: callSid,
    sip_username: username,
    lead_id: leadId,
    to_number: decision.to,
    caller_id: decision.callerId,
    status: 'initiated',
    // Test calls are marked so they never count as pilot data.
    ...(decision.isTest ? { outcome: 'test' } : {}),
  });
  return xml(buildDialTwiml({ callerId: decision.callerId, to: decision.to, actionUrl: publicUrl('/api/twilio/outbound-status') }));
}
