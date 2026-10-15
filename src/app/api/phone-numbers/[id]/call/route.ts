import { NextRequest, NextResponse } from 'next/server';
import { authorizeResource } from '@/lib/authz';
import { tryAcquireToken, TWILIO_TENANT } from '@/lib/rateLimiter';
import { parseCallVariables } from '@/lib/callVariables';
import { placePhoneNumberCall } from '@/lib/placeCall';

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
  let reqBody: { toNumber?: unknown; variables?: unknown };
  try {
    reqBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }
  const toNumber = (reqBody ?? {}).toNumber;
  // Optional per-call dynamic variables ({{name}} placeholders), same semantics as batch-call CSV columns.
  const parsedVars = parseCallVariables(reqBody?.variables);
  if (!parsedVars.ok) return NextResponse.json({ error: parsedVars.error }, { status: 400 });
  const variables = parsedVars.variables;

  if (typeof toNumber !== 'string' || !toNumber.trim()) {
    return NextResponse.json({ error: 'toNumber is required (E.164 format)' }, { status: 400 });
  }

  return placePhoneNumberCall(phoneNumberId, toNumber, variables);
}
