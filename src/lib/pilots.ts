// Pilot monitoring maths. Everything here is pure: callers load pilot and call-log rows and pass them in, with an explicit `now`.
// A pilot is a free one-week trial capped at `minutes_cap` talk minutes (migration 068).

export const PILOT_STATUSES = ['active', 'capped', 'expired', 'converted', 'stopped'] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];

export const DEFAULT_PILOT_DAYS = 7;
export const DEFAULT_MINUTES_CAP = 50;
/** A call shorter than this is almost always a hang-up or a broken forward, so it is surfaced. */
export const SHORT_CALL_SECONDS = 10;

export interface PilotRow {
  id: string;
  tenant_id: string;
  contact_name: string | null;
  contact_email: string | null;
  company: string | null;
  vertical: string | null;
  started_at: string;
  ends_at: string;
  minutes_cap: number;
  status: PilotStatus;
  notes: string | null;
  created_at: string;
}

export interface PilotCall {
  id: string;
  created_at: string;
  duration_seconds: number | null;
  outcome: string | null;
  analysis: Record<string, unknown> | null;
  is_internal_test?: boolean | null;
}

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown';

export interface NotableCall {
  id: string;
  created_at: string;
  reason: 'failed' | 'short' | 'negative' | 'long';
  outcome: string | null;
  seconds: number;
  summary: string | null;
}

export type NextActionCode =
  | 'converted'
  | 'stopped'
  | 'cap_reached_convert'
  | 'ended_convert'
  | 'ended_no_calls'
  | 'check_forwarding'
  | 'wait_for_calls'
  | 'review_failures'
  | 'near_cap'
  | 'offer_followup_call'
  | 'monitor';

export interface NextAction { code: NextActionCode; label: string; urgent: boolean }

export interface PilotStats {
  calls: number;
  secondsUsed: number;
  minutesUsed: number;
  minutesRemaining: number;
  percentOfCap: number;
  outcomes: Record<string, number>;
  failedCalls: number;
  shortCalls: number;
  sentiment: Record<Sentiment, number>;
  lastCallAt: string | null;
  notableCalls: NotableCall[];
  topSummaries: Array<{ id: string; created_at: string; summary: string }>;
  daysLeft: number;
  hoursSinceStart: number;
  /** The status the pilot should have right now: stored status, except active becomes capped/expired from usage and dates. */
  effectiveStatus: PilotStatus;
  /** True when the voice engine should stop serving this pilot's tenant. */
  blocked: boolean;
  blockReason: 'cap' | 'expired' | 'stopped' | null;
  nextAction: NextAction;
  /** When to book the follow-up call: two days before the pilot ends (never before it started). */
  followUpBy: string;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function callSeconds(c: Pick<PilotCall, 'duration_seconds'>): number {
  const s = Number(c.duration_seconds);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

export function callSummary(c: Pick<PilotCall, 'analysis'>): string | null {
  const s = c.analysis && typeof c.analysis === 'object' ? (c.analysis as Record<string, unknown>).call_summary : null;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

export function callSentiment(c: Pick<PilotCall, 'analysis'>): Sentiment {
  const raw = c.analysis && typeof c.analysis === 'object' ? (c.analysis as Record<string, unknown>).user_sentiment : null;
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return v === 'positive' || v === 'neutral' || v === 'negative' ? v : 'unknown';
}

/**
 * A failed call is one the engine marked unsuccessful: post-call analysis call_successful false (boolean or the string "false"), or an
 * outcome of 'failed' / 'error'. An 'abandoned' outcome (the caller hung up) is shown in the outcome breakdown but is not a failure.
 */
export function isFailedCall(c: Pick<PilotCall, 'analysis' | 'outcome'>): boolean {
  const ok = c.analysis && typeof c.analysis === 'object' ? (c.analysis as Record<string, unknown>).call_successful : undefined;
  if (ok === false || (typeof ok === 'string' && ok.trim().toLowerCase() === 'false')) return true;
  const o = (c.outcome || '').toLowerCase();
  return o === 'failed' || o === 'error';
}

export function isShortCall(c: Pick<PilotCall, 'duration_seconds'>): boolean {
  return callSeconds(c) < SHORT_CALL_SECONDS;
}

/** Calls that count toward a pilot: after it started, not our own internal test calls, not calls the engine blocked. */
export function pilotCalls(pilot: Pick<PilotRow, 'started_at'>, calls: PilotCall[]): PilotCall[] {
  const start = Date.parse(pilot.started_at);
  // Calls the engine turned away after the cap (analysis.blocked, see docs/pilot-cap-enforcement.md) are not usage and not alerts.
  const blocked = (c: PilotCall) => !!c.analysis && typeof c.analysis === 'object' && !!(c.analysis as Record<string, unknown>).blocked;
  return calls.filter((c) => !c.is_internal_test && !blocked(c) && Date.parse(c.created_at) >= start);
}

function nextActionFor(
  pilot: PilotRow,
  s: { calls: number; failedCalls: number; percentOfCap: number; daysLeft: number; hoursSinceStart: number; effectiveStatus: PilotStatus }
): NextAction {
  if (s.effectiveStatus === 'converted') return { code: 'converted', label: 'Converted: nothing to do', urgent: false };
  if (s.effectiveStatus === 'stopped') return { code: 'stopped', label: 'Stopped: nothing to do', urgent: false };
  if (s.percentOfCap >= 100) return { code: 'cap_reached_convert', label: 'Cap reached: ask to convert', urgent: true };
  if (s.effectiveStatus === 'expired') {
    return s.calls > 0
      ? { code: 'ended_convert', label: 'Pilot ended: ask to convert or close out', urgent: true }
      : { code: 'ended_no_calls', label: 'Pilot ended with no calls: ask what blocked them, then close out', urgent: true };
  }
  if (s.calls === 0) {
    return s.hoursSinceStart >= 24
      ? { code: 'check_forwarding', label: 'No calls yet: check forwarding', urgent: true }
      : { code: 'wait_for_calls', label: 'Started recently: wait for the first calls', urgent: false };
  }
  if (s.failedCalls > 0) return { code: 'review_failures', label: 'Failed calls: review them and fix the agent', urgent: true };
  if (s.percentOfCap >= 80) return { code: 'near_cap', label: 'Near the cap: offer to extend or convert', urgent: true };
  if (s.daysLeft <= 2) return { code: 'offer_followup_call', label: 'Offer follow-up call', urgent: true };
  return { code: 'monitor', label: 'On track: keep monitoring', urgent: false };
}

export function computePilotStats(pilot: PilotRow, allCalls: PilotCall[], now: Date = new Date()): PilotStats {
  const calls = pilotCalls(pilot, allCalls);
  const secondsUsed = calls.reduce((a, c) => a + callSeconds(c), 0);
  const cap = Number(pilot.minutes_cap) > 0 ? Number(pilot.minutes_cap) : DEFAULT_MINUTES_CAP;
  const minutesUsed = secondsUsed / 60;
  const percentOfCap = (minutesUsed / cap) * 100;

  const outcomes: Record<string, number> = {};
  const sentiment: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
  let failedCalls = 0;
  let shortCalls = 0;
  let last: number | null = null;
  for (const c of calls) {
    const o = c.outcome || 'unknown';
    outcomes[o] = (outcomes[o] || 0) + 1;
    sentiment[callSentiment(c)]++;
    if (isFailedCall(c)) failedCalls++;
    if (isShortCall(c)) shortCalls++;
    const t = Date.parse(c.created_at);
    if (last === null || t > last) last = t;
  }

  const sorted = [...calls].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const notableCalls: NotableCall[] = [];
  const seen = new Set<string>();
  const addNotable = (c: PilotCall, reason: NotableCall['reason']) => {
    if (seen.has(c.id) || notableCalls.length >= 5) return;
    seen.add(c.id);
    notableCalls.push({ id: c.id, created_at: c.created_at, reason, outcome: c.outcome, seconds: callSeconds(c), summary: callSummary(c) });
  };
  for (const c of sorted) if (isFailedCall(c)) addNotable(c, 'failed');
  for (const c of sorted) if (callSentiment(c) === 'negative') addNotable(c, 'negative');
  for (const c of sorted) if (isShortCall(c)) addNotable(c, 'short');
  for (const c of [...calls].sort((a, b) => callSeconds(b) - callSeconds(a))) if (callSeconds(c) >= 120) addNotable(c, 'long');

  const topSummaries = sorted
    .map((c) => ({ id: c.id, created_at: c.created_at, summary: callSummary(c) }))
    .filter((x): x is { id: string; created_at: string; summary: string } => !!x.summary)
    .slice(0, 5);

  const endsMs = Date.parse(pilot.ends_at);
  const startMs = Date.parse(pilot.started_at);
  const nowMs = now.getTime();
  const daysLeft = Math.max(0, Math.ceil((endsMs - nowMs) / DAY));
  const hoursSinceStart = Math.max(0, (nowMs - startMs) / HOUR);

  let effectiveStatus = pilot.status;
  if (pilot.status === 'active' || pilot.status === 'capped' || pilot.status === 'expired') {
    effectiveStatus = percentOfCap >= 100 ? 'capped' : nowMs >= endsMs ? 'expired' : 'active';
  }
  const blockReason: PilotStats['blockReason'] =
    effectiveStatus === 'stopped' ? 'stopped' : effectiveStatus === 'capped' ? 'cap' : effectiveStatus === 'expired' ? 'expired' : null;

  const base = { calls: calls.length, failedCalls, percentOfCap, daysLeft, hoursSinceStart, effectiveStatus };
  return {
    calls: calls.length,
    secondsUsed,
    minutesUsed: round1(minutesUsed),
    minutesRemaining: round1(Math.max(0, cap - minutesUsed)),
    percentOfCap: Math.round(percentOfCap * 10) / 10,
    outcomes,
    failedCalls,
    shortCalls,
    sentiment,
    lastCallAt: last === null ? null : new Date(last).toISOString(),
    notableCalls,
    topSummaries,
    daysLeft,
    hoursSinceStart: Math.round(hoursSinceStart * 10) / 10,
    effectiveStatus,
    blocked: blockReason !== null,
    blockReason,
    nextAction: nextActionFor(pilot, base),
    followUpBy: new Date(Math.max(startMs, endsMs - 2 * DAY)).toISOString(),
  };
}

// ---- Alert events (hourly watch) -------------------------------------------------------------------------------------

export type AlertKind = 'cap_80' | 'cap_100' | 'no_calls_24h' | 'expiring_24h' | 'failed_call' | 'short_call';

export interface PilotAlertEvent {
  /** Unique per pilot and event; stored in calldesk_pilot_events.event_key so it is only ever sent once. */
  key: string;
  kind: AlertKind;
  pilotId: string;
  /** For failed_call / short_call. */
  callId?: string;
  line: string;
}

/**
 * Events that are true for this pilot right now. Stopped and converted pilots raise none. The caller drops events whose key was already
 * sent. Cap events are exclusive (a pilot already at 100% gets cap_100 only, not a late cap_80).
 */
export function computeAlertEvents(pilot: PilotRow, allCalls: PilotCall[], now: Date = new Date()): PilotAlertEvent[] {
  if (pilot.status === 'stopped' || pilot.status === 'converted') return [];
  const s = computePilotStats(pilot, allCalls, now);
  const calls = pilotCalls(pilot, allCalls);
  const ev: PilotAlertEvent[] = [];
  const add = (kind: AlertKind, line: string, callId?: string) =>
    ev.push({ key: `${pilot.id}:${kind}${callId ? `:${callId}` : ''}`, kind, pilotId: pilot.id, callId, line });

  if (s.percentOfCap >= 100) add('cap_100', `Reached 100% of the ${pilot.minutes_cap} minute cap (${s.minutesUsed} min used). The agent should now stop answering.`);
  else if (s.percentOfCap >= 80) add('cap_80', `At ${Math.round(s.percentOfCap)}% of the ${pilot.minutes_cap} minute cap (${s.minutesUsed} min used, ${s.minutesRemaining} left).`);

  const endsMs = Date.parse(pilot.ends_at);
  if (s.calls === 0 && s.hoursSinceStart >= 24 && now.getTime() < endsMs) add('no_calls_24h', 'No calls 24 hours after the pilot started. Check that the number is forwarding to the agent.');

  const untilEnd = endsMs - now.getTime();
  if (untilEnd > 0 && untilEnd <= DAY) add('expiring_24h', `Pilot ends ${pilot.ends_at}. ${s.calls} calls, ${s.minutesUsed} min used so far.`);

  for (const c of calls) {
    if (isFailedCall(c)) add('failed_call', `Failed call at ${c.created_at} (${callSeconds(c)}s, outcome ${c.outcome || 'unknown'}).`, c.id);
    else if (isShortCall(c)) add('short_call', `Call under ${SHORT_CALL_SECONDS}s at ${c.created_at} (${callSeconds(c)}s, outcome ${c.outcome || 'unknown'}).`, c.id);
  }
  return ev;
}

// ---- Cross-pilot topics (weekly report) ------------------------------------------------------------------------------

const STOPWORDS = new Set(
  ('the a an and or but of to in on at for with from by is are was were be been being it its this that these those they them their he she his her ' +
    'caller callers user agent assistant call called calls asked asking wanted wants about would could should will can not no yes also had has have ' +
    'into out up down over as if then than so such just very more most some any other which who whom what when where how why there here our your ' +
    'you we i me my one two get got did does do said says say told tell').split(' ')
);

/** Lowercased content words of a summary, deduplicated within the summary. */
export function summaryKeywords(summary: string): string[] {
  const words = summary.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, ''));
  return [...new Set(words.filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)))];
}

/** Deterministic topic counts: for each content word, how many call summaries mention it. Ties sort alphabetically. */
export function topSummaryTopics(summaries: string[], limit = 8, minCount = 2): Array<{ topic: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of summaries) for (const w of summaryKeywords(s)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([topic, count]) => ({ topic, count }));
}

export function formatMinutes(n: number): string {
  return `${round1(n)}`;
}
