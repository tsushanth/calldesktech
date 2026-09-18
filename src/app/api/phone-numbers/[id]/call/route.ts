import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { authorizeResource } from '@/lib/authz';
import { tryAcquireToken, TWILIO_TENANT } from '@/lib/rateLimiter';

// POST /api/phone-numbers/[id]/call — places a real outbound call FROM this
// number, to test what its own outbound_agent_version_id actually says.
// Mirrors Retell's own "Make an outbound call" button on the Phone Numbers
// detail page.
//
// Branches by which engine actually owns the number's outbound agent
// version. A poc-engine number is bought directly on call-loop-poc's own
// Twilio account (see /api/tenants/[id]/phone-numbers/purchase), so a raw
// Twilio call FROM it works. A retell-engine number is bought through
// Retell's own phone-number inventory — it was never "verified" on OUR
// Twilio account, so the same raw-Twilio call fails with Twilio's "not yet
// verified for your account". Retell owns the number and the agent, so its
// own /v2/create-phone-call is the only thing that can actually place this
// call. (Retell is the comparison baseline in this product, not something
// worth building real Twilio<->Retell SIP-trunk infrastructure around —
// this dispatch is the minimal fix that makes both paths work correctly.)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_phone_numbers', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: phoneNumberId } = await params;
  // Outbound calls cost real money and are now reachable with an API key —
  // pace them per tenant (same bucket batch calling uses), fail closed.
  if (__auth.tenantId && !(await tryAcquireToken(`twilio-tenant-${__auth.tenantId}`, TWILIO_TENANT))) {
    return NextResponse.json({ error: 'Too many calls placed too quickly — retry shortly' }, { status: 429 });
  }
  const { toNumber } = await request.json();

  if (!toNumber || typeof toNumber !== 'string' || !toNumber.trim()) {
    return NextResponse.json({ error: 'toNumber is required (E.164 format)' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: phoneNumber, error } = await supabase
    .from('calldesk_phone_numbers')
    .select('number, outbound_agent_version_id')
    .eq('id', phoneNumberId)
    .single();
  if (error || !phoneNumber) {
    return NextResponse.json({ error: 'Phone number not found' }, { status: 404 });
  }
  if (!phoneNumber.outbound_agent_version_id) {
    return NextResponse.json(
      { error: 'This number has no Outbound Call Agent configured — set one before testing.' },
      { status: 400 }
    );
  }

  const { data: version, error: versionError } = await supabase
    .from('calldesk_agent_versions')
    .select('voice_engine, retell_agent_id')
    .eq('id', phoneNumber.outbound_agent_version_id)
    .single();
  if (versionError || !version) {
    return NextResponse.json({ error: 'Outbound Call Agent version not found' }, { status: 404 });
  }

  if (version.voice_engine === 'retell') {
    if (!version.retell_agent_id) {
      return NextResponse.json({ error: 'This Retell agent version has no retell_agent_id' }, { status: 400 });
    }
    try {
      const retell = getRetellClient();
      const call = await retell.createPhoneCall({
        fromNumber: phoneNumber.number,
        toNumber: toNumber.trim(),
        agentId: version.retell_agent_id,
      });
      return NextResponse.json({ call: { sid: call.call_id, to: toNumber.trim() } }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retell call creation failed';
      return NextResponse.json({ error: `Retell: ${message}` }, { status: 502 });
    }
  }

  const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
  const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (!baseUrl || !secret) {
    return NextResponse.json({ error: 'CALL_LOOP_POC_BASE_URL/CALL_LOOP_POC_TEST_CALL_SECRET not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/place-test-call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toNumber: toNumber.trim(),
        routeAs: phoneNumber.number,
        direction: 'outbound',
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      // call-loop-poc's own error for this case is just the generic wrapper
      // "Twilio call creation failed" — the actually useful part (e.g. "The
      // number +1... is not a valid mobile number", an unverified trial-
      // account destination, geo permissions) is Twilio's raw error body one
      // level down at body.detail.message, which the dashboard was never
      // reading, so every failure surfaced as the same unhelpful string.
      const twilioMessage = typeof body.detail?.message === 'string' ? body.detail.message : null;
      const message = twilioMessage ? `Twilio: ${twilioMessage}` : (body.error || 'call-loop-poc rejected the call');
      return NextResponse.json({ error: message, detail: body }, { status: res.status });
    }
    return NextResponse.json({ call: body }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reach call-loop-poc';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
