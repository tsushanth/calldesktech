import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { pilotBlockResponse } from '@/lib/pilotBlock';

// Places a real outbound call FROM one of a workspace's numbers, using that number's Outbound Call Agent.
// Shared by POST /api/phone-numbers/[id]/call (dashboard and API keys) and the HighLevel workflow action, so both go
// through the same pilot-block check, engine branch (Retell or the poc engine) and error handling.
// The caller is responsible for authorization and rate limiting before calling this.
// The branches are documented where they live in the route's history: a poc-engine number is bought on call-loop-poc's
// own Twilio account, so a raw Twilio call from it works; a Retell-engine number is owned by Retell, so only Retell's
// create-phone-call can place the call.
export async function placePhoneNumberCall(
  phoneNumberId: string,
  toNumber: string,
  variables: Record<string, string> | undefined,
  opts: { tenantId?: string | null } = {},
): Promise<NextResponse> {
  const supabase = getSupabaseAdmin();
  const { data: phoneNumber, error } = await supabase
    .from('calldesk_phone_numbers')
    .select('number, outbound_agent_version_id, tenant_id')
    .eq('id', phoneNumberId)
    .single();
  if (error || !phoneNumber) {
    return NextResponse.json({ error: 'Phone number not found' }, { status: 404 });
  }
  // Callers that act for a workspace (the HighLevel app) pass its id: a number from any other workspace is "not found".
  if (opts.tenantId && phoneNumber.tenant_id !== opts.tenantId) {
    return NextResponse.json({ error: 'Phone number not found' }, { status: 404 });
  }
  // A pilot-blocked tenant places no outbound calls: refuse before any Retell or engine request.
  const blocked = await pilotBlockResponse(supabase, phoneNumber.tenant_id);
  if (blocked) return blocked;
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
        dynamicVariables: variables,
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
        ...(variables ? { variables } : {}),
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
