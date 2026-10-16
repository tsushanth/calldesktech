import { NextRequest, NextResponse } from 'next/server';
import { requireAppSecret } from '@/lib/highlevel/appAuth';
import { getInstall } from '@/lib/highlevel/installs';
import { resolveFromNumber } from '@/lib/highlevel/numbers';
import { normalizePhone, parseVariableLines } from '@/lib/highlevel/phone';
import { parseCallVariables } from '@/lib/callVariables';
import { placePhoneNumberCall } from '@/lib/placeCall';
import { tryAcquireToken, TWILIO_TENANT } from '@/lib/rateLimiter';

// HighLevel workflow action "Place a Calldesk call". HighLevel POSTs { data, extras: { locationId, contactId, workflowId }, meta }.
// Authenticated by the shared app secret; the workspace comes from the sub-account's linked install, never from the body.
//
// Response: 200 with { success, call_sid, to, error }. Problems the workflow author can fix (not linked, bad number, no outbound
// number) are 200 with success false and a readable error, so the workflow can branch on them. Auth failures and rate limits
// use real status codes.

const fail = (error: string) => NextResponse.json({ success: false, call_sid: '', to: '', error });

export async function POST(req: NextRequest) {
  const denied = requireAppSecret(req);
  if (denied) return denied;

  let body: { data?: Record<string, unknown>; extras?: { locationId?: unknown } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const data = body?.data ?? {};
  const locationId = body?.extras?.locationId;
  // HighLevel's Test button in the developer portal sends no real sub-account, and a bare 400 shows up there as an unexplained "Request failed".
  // A missing location is a workflow-authoring situation like the others below: answer 200 with success false and say what it means.
  if (typeof locationId !== 'string' || !locationId) return fail('No HighLevel sub-account came with this request (normal for the portal Test button). The secret and URL are working; run the action from a real workflow to place a call.');

  const install = await getInstall(locationId);
  if (!install || install.status !== 'active') return fail('The Calldesk app is not installed on this HighLevel sub-account. Install it from the HighLevel Marketplace.');
  if (!install.tenant_id) return fail('This HighLevel sub-account is not linked to a Calldesk workspace yet. Open the Calldesk app in HighLevel to finish linking.');
  const tenantId = install.tenant_id;

  const to = normalizePhone(data.phone);
  if (!to) return fail('The contact has no usable phone number. Use a number with a country code, for example +14155550123.');
  const parsed = parseVariableLines(data.variables);
  if (!parsed.ok) return fail(parsed.error);
  const vars = parseCallVariables(parsed.variables);
  if (!vars.ok) return fail(vars.error);

  const from = await resolveFromNumber(tenantId, data.call_from);
  if (!from.ok) return fail(from.error);

  // Same per-workspace pace limit as batch calling and the public API.
  if (!(await tryAcquireToken(`twilio-tenant-${tenantId}`, TWILIO_TENANT))) return NextResponse.json({ error: 'Too many calls placed too quickly, retry shortly' }, { status: 429 });

  const res = await placePhoneNumberCall(from.phoneNumberId, to, vars.variables, { tenantId });
  const out = (await res.json().catch(() => ({}))) as { call?: { sid?: string; callSid?: string; call_sid?: string }; error?: string };
  if (res.status === 201) {
    const c = out.call ?? {};
    return NextResponse.json({ success: true, call_sid: c.sid ?? c.callSid ?? c.call_sid ?? '', to, error: '' });
  }
  return fail(typeof out.error === 'string' && out.error ? out.error : `The call could not be placed (${res.status})`);
}
