// Pure helpers for the human-caller softphone route (/api/twilio/outbound-voice). No I/O so the
// decisions that matter (what number is being dialed, who is dialing, what TwiML goes back) are unit tested.

// A dialable NANP number: +1, area code and exchange both start 2-9. This also rules out short codes,
// 911/N11 and anything international, which a sales caller has no business dialing from this line.
const NANP = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
// Premium-rate area codes: never.
const BLOCKED_AREA_CODES = new Set(['900']);

export function normalizeNanp(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  let e164: string;
  if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`;
  else return null;
  if (!NANP.test(e164)) return null;
  if (BLOCKED_AREA_CODES.has(e164.slice(2, 5))) return null;
  return e164;
}

// "sip:mary@calldesk.sip.twilio.com" / "sip:+14256284887@calldesk.sip.twilio.com;user=phone" -> user part.
export function sipUser(uri: string): string | null {
  const m = /^sips?:([^@;>\s]+)@/i.exec(String(uri ?? '').trim().replace(/^<|>$/g, ''));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function buildDialTwiml(opts: { callerId: string; to: string; actionUrl: string; timeoutSec?: number }): string {
  // answerOnBridge: the caller hears real ringing until the far end answers, and Twilio does not bill the
  // caller's leg as answered while it is still ringing.
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    `<Dial callerId="${xmlEscape(opts.callerId)}" answerOnBridge="true" timeout="${opts.timeoutSec ?? 30}" action="${xmlEscape(opts.actionUrl)}" method="POST">` +
    `<Number>${xmlEscape(opts.to)}</Number></Dial></Response>`
  );
}

export function buildRejectTwiml(spokenMessage: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xmlEscape(spokenMessage)}</Say><Hangup/></Response>`;
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

export interface DialDecisionInput {
  sipUsername: string | null;
  to: string | null;
  caller: { caller_id: string; enabled: boolean } | null;
  leadId: string | null;
  doNotCall: boolean;
  requireLead: boolean;
  dialsToday: number;
  maxDialsPerDay: number;
}

export type DialDecision =
  | { ok: true; to: string; callerId: string }
  | { ok: false; reason: string; spoken: string };

// Order matters only for which reason gets logged; every branch refuses the call.
export function decideDial(i: DialDecisionInput): DialDecision {
  if (!i.sipUsername || !i.caller || !i.caller.enabled) {
    return { ok: false, reason: 'unknown_or_disabled_caller', spoken: 'This line is not set up. Please contact your supervisor.' };
  }
  const to = i.to ? normalizeNanp(i.to) : null;
  if (!to) {
    return { ok: false, reason: 'invalid_number', spoken: 'That number cannot be dialed from this line.' };
  }
  if (i.doNotCall) {
    return { ok: false, reason: 'do_not_call', spoken: 'That number is on the do not call list.' };
  }
  if (i.requireLead && !i.leadId) {
    return { ok: false, reason: 'not_in_call_list', spoken: 'That number is not in your call list.' };
  }
  if (i.dialsToday >= i.maxDialsPerDay) {
    return { ok: false, reason: 'daily_limit', spoken: 'You have reached the daily dial limit.' };
  }
  return { ok: true, to, callerId: i.caller.caller_id };
}

// <Dial action> reports the outcome of the far-end leg.
export function mapDialStatus(dialCallStatus: string | null | undefined): { status: string; answered: boolean } {
  switch (dialCallStatus) {
    case 'completed':
      return { status: 'completed', answered: true };
    case 'answered':
      return { status: 'completed', answered: true };
    case 'busy':
    case 'no-answer':
    case 'failed':
    case 'canceled':
      return { status: dialCallStatus, answered: false };
    default:
      return { status: 'failed', answered: false };
  }
}
