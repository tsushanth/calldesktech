import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyTwilioSignature } from '@/lib/webhookAuth';
import { buildDialTwiml, buildRejectTwiml, decideDial, normalizeNanp, parseTestNumbers, sipUser } from '@/lib/outboundCalling';
import { batchDateEastern, checkCallingHours, startOfEasternDay } from '@/lib/callingHours';
import { pickPoolNumber, type PoolNumber } from '@/lib/outboundNumbers';

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
  // A body that is not a form is a bad request (400), not a server error: Twilio always sends a form, so this is only ever noise.
  const form = await request.formData().catch(() => null);
  if (!form) return new NextResponse('Bad Request', { status: 400 });
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

  // The line gates on today's batch for THIS caller (not on the lead's own phone column, whose format varies).
  let leadId: string | null = null;
  let batchState: string | null = null;
  let inBatch = false;
  let doNotCall = false;
  let dialsToday = 0;
  if (toE164 && username) {
    const row = (
      await supabase
        .from('calldesk_call_batches')
        .select('lead_id, state')
        .eq('batch_date', batchDateEastern())
        .eq('sip_username', username)
        .eq('phone', toE164)
        .maybeSingle()
    ).data;
    inBatch = !!row;
    leadId = row?.lead_id ?? null;
    batchState = row?.state ?? null;
  }
  if (toE164) {
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
    inBatch,
    hours: checkCallingHours(batchState),
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

  // Pick the number to dial out from: the pool's least-used number under its daily cap, preferring one whose
  // area code matches the person called. An empty pool falls back to the caller's own caller ID.
  let callerId = decision.callerId;
  const pool = ((await supabase.from('calldesk_outbound_numbers').select('phone, area_codes, daily_cap, enabled')).data ?? []) as PoolNumber[];
  if (pool.length > 0) {
    const used = (
      await supabase
        .from('calldesk_outbound_calls')
        .select('caller_id')
        .neq('status', 'rejected')
        .gte('started_at', startOfEasternDay().toISOString())
    ).data ?? [];
    const usage: Record<string, number> = {};
    for (const r of used as { caller_id: string }[]) usage[r.caller_id] = (usage[r.caller_id] ?? 0) + 1;
    const picked = pickPoolNumber(pool, usage, decision.to);
    if (!picked) {
      await supabase.from('calldesk_outbound_calls').insert({
        call_sid: callSid, sip_username: username, lead_id: leadId, to_number: decision.to, caller_id: 'none',
        status: 'rejected', reject_reason: 'numbers_at_daily_limit', ended_at: new Date().toISOString(),
      });
      return xml(buildRejectTwiml('All calling numbers have reached today\'s limit.'));
    }
    callerId = picked.phone;
  }

  await supabase.from('calldesk_outbound_calls').insert({
    call_sid: callSid,
    sip_username: username,
    lead_id: leadId,
    to_number: decision.to,
    caller_id: callerId,
    status: 'initiated',
    // Test calls are marked so they never count as pilot data.
    ...(decision.isTest ? { outcome: 'test' } : {}),
  });
  // Recording is off unless OUTBOUND_RECORDING=1. When on, the callee hears a short notice before being
  // connected unless OUTBOUND_RECORDING_NOTICE=0 (not recommended: some states need everyone's consent).
  const recording =
    process.env.OUTBOUND_RECORDING === '1'
      ? {
          statusCallbackUrl: publicUrl('/api/twilio/outbound-recording'),
          noticeUrl: process.env.OUTBOUND_RECORDING_NOTICE === '0' ? undefined : publicUrl('/api/twilio/outbound-whisper'),
        }
      : undefined;
  return xml(buildDialTwiml({ callerId, to: decision.to, actionUrl: publicUrl('/api/twilio/outbound-status'), recording }));
}
