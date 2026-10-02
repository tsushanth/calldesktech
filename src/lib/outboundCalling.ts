import type { HoursCheck } from '@/lib/callingHours';

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

// Numbers callers may dial for setup and test calls (the supervisor's own phone): they bypass the
// lead-list and do-not-call checks, and the call is logged with outcome "test" so it never counts
// as pilot data. Comma-separated, any common US format; invalid entries are ignored.
export function parseTestNumbers(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const part of String(raw ?? '').split(',')) {
    const n = normalizeNanp(part.trim());
    if (n) out.add(n);
  }
  return out;
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

export interface RecordingOptions {
  // Twilio posts here when the recording is ready (RecordingSid, RecordingUrl, RecordingDuration).
  statusCallbackUrl: string;
  // If set, the person called hears a short notice (TwiML from this URL) before they are connected.
  noticeUrl?: string;
}

export function buildDialTwiml(opts: { callerId: string; to: string; actionUrl: string; timeoutSec?: number; recording?: RecordingOptions }): string {
  // The <Dial action> only fires when the dial finishes with the caller still on the line. The <Number>
  // status callbacks fire for the far-end leg regardless (answered / any final state), so a call that
  // the caller hangs up first, or that fails on the SIP side, still gets its outcome recorded.
  // answerOnBridge: the caller hears real ringing until the far end answers, and Twilio does not bill the
  // caller's leg as answered while it is still ringing.
  // Recording (only when enabled): both sides on separate channels from the moment the callee answers, kept
  // by Twilio until deleted. The optional notice is a whisper on the callee's leg, played before they are bridged.
  const rec = opts.recording;
  const recAttrs = rec
    ? ` record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(rec.statusCallbackUrl)}" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"`
    : '';
  const whisper = rec?.noticeUrl ? ` url="${xmlEscape(rec.noticeUrl)}" method="POST"` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    `<Dial callerId="${xmlEscape(opts.callerId)}" answerOnBridge="true" timeout="${opts.timeoutSec ?? 30}" action="${xmlEscape(opts.actionUrl)}" method="POST"${recAttrs}>` +
    `<Number${whisper} statusCallback="${xmlEscape(opts.actionUrl)}" statusCallbackEvent="answered completed" statusCallbackMethod="POST">${xmlEscape(opts.to)}</Number></Dial></Response>`
  );
}

// The short notice the person called hears before being connected, when recording is on.
export const RECORDING_NOTICE_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This call may be recorded for quality.</Say></Response>';

export function buildRejectTwiml(spokenMessage: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xmlEscape(spokenMessage)}</Say><Hangup/></Response>`;
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

export interface DialDecisionInput {
  sipUsername: string | null;
  to: string | null;
  caller: { caller_id: string; enabled: boolean } | null;
  leadId: string | null;
  // True when the number is in this caller's batch for today (the thing the line actually gates on).
  inBatch: boolean;
  hours: HoursCheck;
  doNotCall: boolean;
  isTestNumber?: boolean;
  requireLead: boolean;
  dialsToday: number;
  maxDialsPerDay: number;
}

export type DialDecision =
  | { ok: true; to: string; callerId: string; isTest: boolean }
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
  if (!i.isTestNumber) {
    if (i.doNotCall) {
      return { ok: false, reason: 'do_not_call', spoken: 'That number is on the do not call list.' };
    }
    if (i.requireLead && !i.inBatch) {
      return { ok: false, reason: 'not_in_todays_batch', spoken: 'That number is not in your batch for today.' };
    }
    if (!i.hours.ok) {
      return { ok: false, reason: 'outside_calling_hours', spoken: 'It is outside calling hours for that business.' };
    }
  }
  if (i.dialsToday >= i.maxDialsPerDay) {
    return { ok: false, reason: 'daily_limit', spoken: 'You have reached the daily dial limit.' };
  }
  return { ok: true, to, callerId: i.caller.caller_id, isTest: !!i.isTestNumber };
}

// Far-end leg status, from either <Dial action> (DialCallStatus) or the <Number> status callback
// (CallStatus). `final` false means "still in progress": it must not overwrite a final outcome.
export function mapDialStatus(status: string | null | undefined): { status: string; answered: boolean; final: boolean } | null {
  switch (status) {
    case 'in-progress':
    case 'answered':
      return { status: 'answered', answered: true, final: false };
    case 'completed':
      return { status: 'completed', answered: true, final: true };
    case 'busy':
    case 'no-answer':
    case 'failed':
    case 'canceled':
      return { status, answered: false, final: true };
    case 'initiated':
    case 'queued':
    case 'ringing':
      return null; // progress noise: nothing to record
    default:
      return { status: 'failed', answered: false, final: true };
  }
}
