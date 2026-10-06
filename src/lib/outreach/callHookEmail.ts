// "We tried calling you" email, written from a real logged call. When a caller reaches voicemail or nobody answers, the lead has just
// shown the exact problem Calldesk solves, and saying so (with the real time) is specific and true. The text is deterministic: no
// model call, so it costs no quota and cannot invent anything. Only ever built for outcomes no_answer and voicemail.

export type HookOutcome = 'no_answer' | 'voicemail';

// Primary time zone per state (a state split across two zones uses the zone most of its people are in).
const STATE_TZ: Record<string, string> = {
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', ME: 'America/New_York', MI: 'America/New_York', NH: 'America/New_York', NJ: 'America/New_York', NY: 'America/New_York',
  NC: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', VT: 'America/New_York',
  VA: 'America/New_York', WV: 'America/New_York', IN: 'America/New_York', KY: 'America/New_York',
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago', IA: 'America/Chicago', KS: 'America/Chicago', LA: 'America/Chicago',
  MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago', NE: 'America/Chicago', ND: 'America/Chicago', OK: 'America/Chicago',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', WI: 'America/Chicago',
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Denver', MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles', AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

export function timezoneForState(state: string | null | undefined): string | null {
  return STATE_TZ[String(state ?? '').trim().toUpperCase()] ?? null;
}

const TZ_NAME: Record<string, string> = {
  'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona',
  'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii',
};

/** "11:42 am Central" in the lead's own time zone, or null when the state is unknown (we then say only "today"). */
export function localCallTime(calledAt: Date, state: string | null | undefined): string | null {
  const tz = timezoneForState(state);
  if (!tz) return null;
  const t = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(calledAt);
  return `${t.replace(/\s?([AP])M/i, (_, ap: string) => ` ${ap.toLowerCase()}m`)} ${TZ_NAME[tz]}`;
}

export interface CallHookInput {
  company: string;
  product: string | null; // e.g. 'calldesk:freight'
  outcome: HookOutcome;
  calledAt: Date;
  state: string | null;
}

const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();

export function buildCallHookEmail(i: CallHookInput): { subject: string; body: string } {
  const company = clean(i.company) || 'your company';
  const when = localCallTime(i.calledAt, i.state);
  const at = when ? `at ${when} today` : 'today';
  const what = i.outcome === 'voicemail' ? 'it went to voicemail' : 'nobody picked up';
  const freight = i.product === 'calldesk:freight';
  const callers = freight ? 'a carrier or shipper calls' : 'a customer calls';
  const collects = freight ? "takes the MC number, the load and a callback number" : 'takes their name, what they need and a callback number';
  const body = [
    'Hi,',
    `We tried calling ${company} ${at} and ${what}. That is the moment Calldesk is built for: when ${callers} and nobody can pick up, an AI phone agent answers, ${collects}, and you get a summary and transcript of every call.`,
    `If you would like to hear it, reply "yes" and we will set up a free test line for ${company}: one week, capped at 50 minutes of calls, no credit card, stop any time. Or listen to a short sample call below.`,
    'Sushanth & Deepika\nCo-founders, Calldesk (calldesk.tech)',
  ].join('\n\n');
  return { subject: `We tried calling ${company} today`.slice(0, 120), body };
}
