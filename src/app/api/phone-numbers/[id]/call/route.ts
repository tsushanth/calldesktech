import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/phone-numbers/[id]/call — places a real outbound call FROM this
// number, to test what its own outbound_agent_version_id actually says.
// Mirrors Retell's own "Make an outbound call" button on the Phone Numbers
// detail page. Proxies to call-loop-poc's own POST /place-test-call, which
// is what actually talks to Twilio — this route's job is just resolving
// "which number" to "the real E.164 string + a bearer secret", server-side
// only (the secret never reaches the browser).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: phoneNumberId } = await params;
  const { toNumber } = await request.json();

  if (!toNumber || typeof toNumber !== 'string' || !toNumber.trim()) {
    return NextResponse.json({ error: 'toNumber is required (E.164 format)' }, { status: 400 });
  }

  const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
  const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (!baseUrl || !secret) {
    return NextResponse.json({ error: 'CALL_LOOP_POC_BASE_URL/CALL_LOOP_POC_TEST_CALL_SECRET not configured' }, { status: 500 });
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
      return NextResponse.json({ error: body.error || 'call-loop-poc rejected the call', detail: body }, { status: res.status });
    }
    return NextResponse.json({ call: body }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reach call-loop-poc';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
