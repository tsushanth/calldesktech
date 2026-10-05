// After-the-call issue detection: deterministic checks (regex and heuristics, no LLM call, no cost) over the stored transcript and
// call metadata. Each finished call gets analysis.issues = [{ code, severity, message, evidence, fix }] so a customer can see where an
// agent claimed something it could not do. Every detector is conservative: a missed issue is cheaper than a false accusation.
//
// Pure functions live at the top (unit-tested); the Supabase-backed context loader and storage helpers are at the bottom.

import type { SupabaseClient } from '@supabase/supabase-js';

export type IssueSeverity = 'high' | 'medium' | 'low';
export type IssueCode =
  | 'claimed_booking_without_tool'
  | 'placeholder_read_aloud'
  | 'number_readback_mismatch'
  | 'no_fields_collected'
  | 'long_silence';

export interface CallIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  evidence: string[];
  fix: string;
}

export interface Turn { role: 'user' | 'assistant'; text: string; timestamp?: number }

export interface CallIssueInput {
  /** calldesk_call_logs.transcript: [{ role: 'user' | 'assistant', content }] (a plain string or other shape yields no turns). */
  transcript: unknown;
  durationSeconds?: number | null;
  analysis?: unknown;
  isInternalTest?: boolean | null;
  extractedData?: unknown;
  /**
   * Whether check_availability / book_appointment were offered on this call: false when the tenant had no calendar connection at
   * call time or the version has calendarTools === false; true when they were; null when unknown.
   */
  bookingToolsAvailable?: boolean | null;
  /** Names of tools the call actually invoked, when the call log records them. null/undefined: not recorded (today's reality). */
  toolCalls?: string[] | null;
  /** True when the version's flow has extraction nodes with fields to collect; null when unknown. */
  expectsFields?: boolean | null;
}

export const ISSUE_CODES: IssueCode[] = ['claimed_booking_without_tool', 'placeholder_read_aloud', 'number_readback_mismatch', 'no_fields_collected', 'long_silence'];

// ---------------------------------------------------------------------------------------------------------------------------------
// Shared helpers

export function normalizeTranscript(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const out: Turn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    const content = typeof r.content === 'string' ? r.content : typeof r.text === 'string' ? r.text : null;
    if (content == null || !content.trim()) continue;
    const role = r.role === 'assistant' || r.role === 'agent' ? 'assistant' : r.role === 'user' ? 'user' : null;
    if (!role) continue; // 'system' (Retell blob) and unknown roles carry no reliable speaker
    const ts = typeof r.timestamp === 'number' ? r.timestamp : undefined;
    out.push({ role, text: content, ...(ts != null ? { timestamp: ts } : {}) });
  }
  return out;
}

function sentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

function clip(s: string, n = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Calls detectors must skip entirely: blocked pilot calls and our own internal/test calls. */
export function isExcludedFromIssues(call: { analysis?: unknown; isInternalTest?: boolean | null }): boolean {
  if (call.isInternalTest) return true;
  const a = asObject(call.analysis);
  return !!a && (a.blocked === 'pilot' || (a.blocked != null && a.blocked !== false));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. claimed_booking_without_tool

// A sentence is a booking/availability claim when it matches one of these...
const BOOKED_CLAIMS: RegExp[] = [
  /\b(?:i(?:'ve|\s+have)|we(?:'ve|\s+have)|i\s+just|we\s+just|i(?:'ll|\s+will)\s+go\s+ahead\s+and)\s+(?:now\s+|already\s+|just\s+)?(?:booked|scheduled|confirmed|reserved|(?:got|put)\s+you\s+(?:down|booked|scheduled|in))\b/i,
  /\b(?:your|the)\s+(?:appointment|booking|reservation|visit|consultation|cleaning|slot)\s+(?:is|has\s+been|was)\s+(?:now\s+)?(?:booked|confirmed|scheduled|set|all\s+set)\b/i,
  /\byou(?:'re|\s+are)\s+(?:all\s+set\s+for|booked|scheduled|confirmed|down\s+for|on\s+the\s+calendar|good\s+to\s+go\s+for)\b/i,
  /\byou(?:'re|\s+are)\s+all\s+set\s+(?:on|at|with\s+an?\s+appointment)\b/i,
];
const TIME_REF = String.raw`(?:\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)|(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|tonight|today|noon|(?:that|this)\s+(?:time|slot|day|date))`;
const AVAILABILITY_CLAIMS: RegExp[] = [
  new RegExp(String.raw`\b${TIME_REF}[^.?!]{0,30}?\b(?:is|are)\s+(?:still\s+)?(?:available|open|free)\b`, 'i'),
  new RegExp(String.raw`\b${TIME_REF}[^.?!]{0,15}?\bworks\b`, 'i'),
  new RegExp(String.raw`\bwe\s+(?:do\s+)?have\s+(?:an?\s+)?(?:opening|openings|availability|slots?)\s+(?:at|on|for)\b`, 'i'),
];
// ...unless the same sentence hedges, asks, or says someone else will confirm (a request-taking agent is doing the right thing).
const HEDGE = /\?\s*$|\b(?:if|would|could|might|should|hope|can\s+i|do\s+you|does\s+that|let\s+me\s+(?:check|see)|someone|somebody|team|staff|they(?:'ll|\s+will)|will\s+(?:confirm|call|reach|follow|text|email)|to\s+confirm|need\s+to\s+confirm|once\s|pending|request|tentative|not\s+(?:yet\s+)?confirmed|unconfirmed)\b/i;
const BOOKING_TOOL_NAMES = /^(?:book_appointment|check_availability)$/;

export function detectClaimedBookingWithoutTool(input: CallIssueInput): CallIssue | null {
  const turns = normalizeTranscript(input.transcript);
  if (turns.length === 0) return null;
  const toolsMissing = input.bookingToolsAvailable === false;
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : null;
  const noToolUsed = toolCalls != null && !toolCalls.some((t) => BOOKING_TOOL_NAMES.test(t));
  // Without a signal that the tools were missing or went unused we cannot tell a real booking from an invented one.
  if (!toolsMissing && !noToolUsed) return null;

  const evidence: string[] = [];
  for (const t of turns) {
    if (t.role !== 'assistant') continue;
    for (const s of sentences(t.text)) {
      if (HEDGE.test(s)) continue;
      if (BOOKED_CLAIMS.some((re) => re.test(s)) || AVAILABILITY_CLAIMS.some((re) => re.test(s))) {
        if (!evidence.includes(clip(s))) evidence.push(clip(s));
      }
    }
  }
  if (evidence.length === 0) return null;
  return {
    code: 'claimed_booking_without_tool',
    severity: 'high',
    message: toolsMissing
      ? 'The agent told the caller an appointment or time was booked, confirmed or available, but it had no calendar to check or book with on this call. Nothing was actually booked.'
      : 'The agent told the caller an appointment or time was booked, confirmed or available, but it never used its calendar tools on this call. Nothing was actually booked.',
    evidence: evidence.slice(0, 3),
    fix: 'Connect a calendar under Integrations so the agent can really check and book, or change the prompt so the agent takes the booking request (day, time, contact details) and says someone will confirm, instead of confirming a time itself.',
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. placeholder_read_aloud

const NAME_WORDS = String.raw`(?:your|their|the|my|insert|enter|company|business|agent|customer|caller|client|first|last|full|name|phone|number|email|date|time|address|city|service|product|practice|clinic|doctor|dr\.?|owner|manager|representative|rep|location|day)`;
const SSML_TAGS = new Set(['speak', 'break', 'emphasis', 'prosody', 'say-as', 'phoneme', 'sub', 'lang', 'p', 's', 'voice', 'audio', 'mark']);
const PLACEHOLDER_PATTERNS: Array<(s: string) => string | null> = [
  (s) => s.match(new RegExp(String.raw`\[\s*${NAME_WORDS}\b[^\]\n]{0,40}\]`, 'i'))?.[0] ?? null, // [Your Name], [Company], [INSERT DATE]
  (s) => s.match(/\{\{\s*[\w .-]{1,40}\s*\}\}/)?.[0] ?? null, // {{variable}}
  (s) => s.match(/\{\s*[a-z][a-z0-9_]{1,30}\s*\}/i)?.[0] ?? null, // {business_name}
  (s) => {
    for (const m of s.matchAll(/<\s*([A-Za-z][A-Za-z _-]{1,30})\s*>/g)) {
      if (!SSML_TAGS.has(m[1].trim().toLowerCase())) return m[0]; // <name>
    }
    return null;
  },
  (s) => s.match(/\b(?:insert|enter|fill\s+in)\s+(?:your\s+|the\s+|a\s+)?(?:name|company|business|date|time|phone|email|address)\b(?:\s+here)?/i)?.[0] ?? null,
  (s) => s.match(/\bX{3}[-\s]?X{3}[-\s]?X{4}\b|_{4,}/)?.[0] ?? null, // XXX-XXX-XXXX, ____
];

export function detectPlaceholderReadAloud(input: CallIssueInput): CallIssue | null {
  const evidence: string[] = [];
  for (const t of normalizeTranscript(input.transcript)) {
    if (t.role !== 'assistant') continue;
    for (const s of sentences(t.text)) {
      const hit = PLACEHOLDER_PATTERNS.map((p) => p(s)).find((h) => h);
      if (hit && !evidence.includes(clip(s))) evidence.push(clip(s));
    }
  }
  if (evidence.length === 0) return null;
  return {
    code: 'placeholder_read_aloud',
    severity: 'medium',
    message: 'The agent read an unfilled template placeholder out loud to the caller, so a variable in the prompt was never replaced.',
    evidence: evidence.slice(0, 3),
    fix: 'Find the bracketed or {{variable}} text in the agent prompt, greeting or node messages and replace it with the real value (or set the variable when the agent is published).',
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. number_readback_mismatch

const DIGIT_WORDS: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
const MULTIPLIERS: Record<string, number> = { double: 2, triple: 3 };
const MIN_CALLER_DIGITS = 7;

interface DigitRun { digits: string; hadMultiplier: boolean }

/** Maximal runs of digits in a text: numerals, spelled digits ("five five five"), "double/triple five", separated by spaces, dashes, dots, commas or parentheses. */
export function extractDigitRuns(text: string): DigitRun[] {
  const tokens: Array<{ start: number; end: number; digits: string; oh: boolean; mult: boolean }> = [];
  const re = /\d+|[a-z]+/gi;
  let m: RegExpExecArray | null;
  let pendingMult = 0;
  let pendingEnd = -1;
  while ((m = re.exec(text))) {
    const w = m[0].toLowerCase();
    if (/^\d+$/.test(w)) { tokens.push({ start: m.index, end: m.index + w.length, digits: w, oh: false, mult: false }); pendingMult = 0; continue; }
    if (w in MULTIPLIERS) { pendingMult = MULTIPLIERS[w]; pendingEnd = m.index + w.length; continue; }
    if (w in DIGIT_WORDS) {
      const d = DIGIT_WORDS[w];
      const mult = pendingMult > 0 && /^\s*$/.test(text.slice(pendingEnd, m.index));
      tokens.push({ start: mult ? pendingEnd - 6 : m.index, end: m.index + w.length, digits: d.repeat(mult ? pendingMult : 1), oh: w === 'oh', mult });
      pendingMult = 0;
      continue;
    }
    pendingMult = 0;
    tokens.push({ start: m.index, end: m.index + w.length, digits: '', oh: false, mult: false }); // a non-digit word breaks runs
  }
  const runs: DigitRun[] = [];
  let cur: typeof tokens = [];
  const flush = () => {
    // "oh" counts only inside a run ("oh" at an edge is the interjection)
    while (cur.length && cur[0].oh) cur.shift();
    while (cur.length && cur[cur.length - 1].oh) cur.pop();
    const digits = cur.map((t) => t.digits).join('');
    if (digits) runs.push({ digits, hadMultiplier: cur.some((t) => t.mult) });
    cur = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.digits) { flush(); continue; }
    if (cur.length) {
      const gap = text.slice(cur[cur.length - 1].end, t.start);
      if (!/^[\s\-.,()+/]*$/.test(gap)) flush();
    }
    cur.push(t);
  }
  flush();
  return runs;
}

const READBACK_CUE = /\b(?:that(?:'s|\s+is)|is\s+that|so\s+(?:that|your|i)|got\s+it|let\s+me\s+(?:confirm|repeat|read)|read(?:ing)?\s+(?:that\s+)?back|repeat|confirm|i\s+have|i(?:'ve|\s+have)\s+(?:got|that)|your\s+(?:phone\s+)?number|number\s+is|correct|right\?)/i;

function sharedAffix(a: string, b: string): boolean {
  return (a.length >= 3 && b.length >= 3) && (a.slice(0, 3) === b.slice(0, 3) || a.slice(-3) === b.slice(-3));
}

function describeMismatch(caller: string, agent: string): string {
  if (caller.length !== agent.length) return `the caller gave ${caller.length} digits but the agent read back ${agent.length}`;
  let i = 0;
  while (caller[i] === agent[i]) i++;
  return `the digits differ at position ${i + 1} (caller ${caller[i]}, agent ${agent[i]})`;
}

interface ReadbackPair { caller: string; agent: string; callerTurn: string; agentTurn: string; match: boolean }

export function detectNumberReadbackMismatch(input: CallIssueInput): CallIssue | null {
  const turns = normalizeTranscript(input.transcript);
  const pairs: ReadbackPair[] = [];
  for (let i = 0; i < turns.length; i++) {
    const u = turns[i];
    if (u.role !== 'user') continue;
    const runs = extractDigitRuns(u.text).filter((r) => r.digits.length >= MIN_CALLER_DIGITS);
    // One clear number per turn only; "double five" is skipped because the engine's own speech normaliser drops that word.
    if (runs.length !== 1 || runs[0].hadMultiplier) continue;
    const caller = runs[0].digits;
    // Compare against the next assistant turn (a read-back comes immediately; later turns are a different topic).
    let a = i + 1;
    if (turns[a]?.role === 'user') a++; // tolerate one split caller turn
    const next = turns[a];
    if (!next || next.role !== 'assistant') continue;
    const agentRuns = extractDigitRuns(next.text).filter((r) => r.digits.length >= 5);
    if (agentRuns.length === 0) continue;
    // Pick the agent run closest in length to what the caller said.
    const agent = agentRuns.reduce((best, r) => (Math.abs(r.digits.length - caller.length) < Math.abs(best.digits.length - caller.length) ? r : best)).digits;
    if (Math.abs(agent.length - caller.length) > 3) continue;
    if (agent === caller) { pairs.push({ caller, agent, callerTurn: u.text, agentTurn: next.text, match: true }); continue; }
    // A leading area code (7 vs 10 digits) or country code (10 vs 11) added or dropped is not a mismatch; a truncated read-back is.
    const [short, long] = agent.length <= caller.length ? [agent, caller] : [caller, agent];
    const addedPrefix = long.endsWith(short) && ((short.length === 7 && long.length === 10) || (short.length === 10 && long.length === 11 && long[0] === '1'));
    if (addedPrefix) { pairs.push({ caller, agent, callerTurn: u.text, agentTurn: next.text, match: true }); continue; }
    // Only treat it as a read-back of this number when it clearly relates to it.
    if (!sharedAffix(caller, agent) && !READBACK_CUE.test(next.text)) continue;
    pairs.push({ caller, agent, callerTurn: u.text, agentTurn: next.text, match: false });
  }
  const unresolved = pairs.filter((p, idx) => !p.match && !pairs.slice(idx + 1).some((q) => q.match && sharedAffix(q.caller, p.caller)));
  if (unresolved.length === 0) return null;
  const first = unresolved[0];
  return {
    code: 'number_readback_mismatch',
    severity: 'medium',
    message: `The agent read a phone number back differently from what the caller gave and the caller did not get a correct read-back afterwards: ${describeMismatch(first.caller, first.agent)}. The number saved from this call may be wrong.`,
    evidence: unresolved.slice(0, 2).flatMap((p) => [`Caller: "${clip(p.callerTurn, 120)}"`, `Agent: "${clip(p.agentTurn, 120)}"`]).slice(0, 4),
    fix: 'Add to the agent prompt: read the number back digit by digit in groups, and wait for a clear yes before moving on. For critical numbers, also send an SMS confirmation or ask the caller to repeat it.',
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. no_fields_collected

export function detectNoFieldsCollected(input: CallIssueInput): CallIssue | null {
  if (!input.expectsFields) return null;
  const duration = input.durationSeconds ?? 0;
  if (duration <= 30) return null;
  // Collected fields are not persisted by the engine today (extracted_data stays null). Only an explicit empty record counts as
  // "recorded none"; a missing value means we cannot tell.
  const ed = asObject(input.extractedData);
  const a = asObject(input.analysis);
  const collected = asObject(a?.collected) ?? asObject(a?.extracted_data);
  const holder = ed ?? collected;
  if (!holder) return null;
  const filled = Object.values(holder).some((v) => v != null && String(v).trim() !== '');
  if (filled) return null;
  return {
    code: 'no_fields_collected',
    severity: 'medium',
    message: `The agent's flow asks for details (name, contact, reason), but the call lasted ${Math.round(duration)} seconds and none were recorded.`,
    evidence: [`Call duration ${Math.round(duration)}s; no extracted fields recorded.`],
    fix: 'Review the extraction steps in the flow: make sure the agent asks for each field early, and that the caller is not sent to a transfer or goodbye step before the fields are collected.',
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5. long_silence (only when the transcript carries timestamps; none of today's transcripts do, so this is dormant)

const LONG_SILENCE_MS = 12_000;
export function detectLongSilence(input: CallIssueInput): CallIssue | null {
  const turns = normalizeTranscript(input.transcript);
  if (turns.length < 2 || !turns.every((t) => typeof t.timestamp === 'number')) return null;
  // timestamps may be seconds or milliseconds; treat values below 1e6 as seconds
  const scale = turns.every((t) => (t.timestamp as number) < 1e6) ? 1000 : 1;
  for (let i = 1; i < turns.length; i++) {
    const gap = ((turns[i].timestamp as number) - (turns[i - 1].timestamp as number)) * scale;
    if (gap >= LONG_SILENCE_MS) {
      return {
        code: 'long_silence',
        severity: 'low',
        message: `There was a ${Math.round(gap / 1000)} second silence between turns.`,
        evidence: [`After: "${clip(turns[i - 1].text, 100)}"`],
        fix: 'Check whether a slow tool, calendar or webhook call is holding up the reply, and add a short spoken filler ("one moment") before slow steps.',
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Orchestration

const DETECTORS: Array<(i: CallIssueInput) => CallIssue | null> = [
  detectClaimedBookingWithoutTool,
  detectPlaceholderReadAloud,
  detectNumberReadbackMismatch,
  detectNoFieldsCollected,
  detectLongSilence,
];

/** Runs every detector. A detector that throws is dropped; the others still run. Blocked, internal-test and under-15-second calls yield []. */
export function detectCallIssues(input: CallIssueInput): CallIssue[] {
  try {
    if (isExcludedFromIssues({ analysis: input.analysis, isInternalTest: input.isInternalTest })) return [];
    if (typeof input.durationSeconds === 'number' && input.durationSeconds < 15) return [];
  } catch {
    return [];
  }
  const out: CallIssue[] = [];
  for (const d of DETECTORS) {
    try {
      const issue = d(input);
      if (issue) out.push(issue);
    } catch (err) {
      console.error('[callIssues] detector failed:', err);
    }
  }
  return out;
}

/** Issues stored on a call's analysis (tolerant of anything else). */
export function issuesFromAnalysis(analysis: unknown): CallIssue[] {
  const a = asObject(analysis);
  const issues = a?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter((i): i is CallIssue => !!i && typeof i === 'object' && typeof (i as CallIssue).code === 'string');
}

export function hasIssues(call: { analysis?: unknown; is_internal_test?: boolean | null }): boolean {
  return !call.is_internal_test && issuesFromAnalysis(call.analysis).length > 0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Context loading and storage (Supabase)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export interface CallRowForIssues {
  id?: string;
  tenant_id: string | null;
  retell_call_id?: string | null;
  to_number?: string | null;
  direction?: string | null;
  created_at: string;
  duration_seconds: number | null;
  transcript: unknown;
  extracted_data?: unknown;
  analysis?: unknown;
  is_internal_test?: boolean | null;
}

export interface TenantCallContext { calendarConnectedSince: string | null }

/** Calendar-connection state for a tenant (one query), reusable across many calls of that tenant. */
export async function loadTenantCallContext(db: Db, tenantId: string): Promise<TenantCallContext> {
  try {
    const { data, error } = await db.from('calldesk_calendar_connections').select('created_at').eq('tenant_id', tenantId).maybeSingle();
    if (error || !data) return { calendarConnectedSince: null };
    return { calendarConnectedSince: typeof data.created_at === 'string' ? data.created_at : '1970-01-01T00:00:00Z' };
  } catch {
    return { calendarConnectedSince: null };
  }
}

interface FlowFacts { calendarToolsOff: boolean; hasExtractionFields: boolean }

/** The flow behind a call, resolved from the number it ran on (engine calls) or the Retell agent id. null when it cannot be resolved. */
export async function loadFlowFacts(db: Db, call: Pick<CallRowForIssues, 'tenant_id' | 'to_number' | 'direction'>, retellAgentId?: string | null): Promise<FlowFacts | null> {
  try {
    let versionId: string | null = null;
    let flowId: string | null = null;
    if (retellAgentId) {
      const { data } = await db.from('calldesk_agent_versions').select('flow_id').eq('retell_agent_id', retellAgentId).order('version_number', { ascending: false }).limit(1).maybeSingle();
      flowId = data?.flow_id ?? null;
    } else if (call.tenant_id && call.to_number) {
      const { data } = await db.from('calldesk_phone_numbers').select('inbound_agent_version_id, outbound_agent_version_id').eq('tenant_id', call.tenant_id).eq('number', call.to_number).maybeSingle();
      versionId = (call.direction === 'outbound' ? data?.outbound_agent_version_id : data?.inbound_agent_version_id) ?? null;
      if (versionId) {
        const { data: v } = await db.from('calldesk_agent_versions').select('flow_id').eq('id', versionId).maybeSingle();
        flowId = v?.flow_id ?? null;
      }
    }
    if (!flowId) return null;
    const { data: flow } = await db.from('calldesk_conversation_flows').select('nodes, global_settings').eq('id', flowId).maybeSingle();
    if (!flow) return null;
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as Array<Record<string, unknown>>) : [];
    const hasExtractionFields = nodes.some((n) => n?.type === 'extraction' && asObject(n.extract) && Object.keys(n.extract as object).length > 0);
    return { calendarToolsOff: asObject(flow.global_settings)?.calendarTools === false, hasExtractionFields };
  } catch {
    return null;
  }
}

/** Builds detector input for a stored call row. Tool calls are not recorded on the call log, so bookingToolsAvailable comes from calendar state at call time. */
export async function buildIssueInput(db: Db, call: CallRowForIssues, opts: { tenantContext?: TenantCallContext; retellAgentId?: string | null } = {}): Promise<CallIssueInput> {
  const ctx = opts.tenantContext ?? (call.tenant_id ? await loadTenantCallContext(db, call.tenant_id) : { calendarConnectedSince: null });
  const flow = await loadFlowFacts(db, call, opts.retellAgentId);
  let bookingToolsAvailable: boolean | null;
  if (flow?.calendarToolsOff) bookingToolsAvailable = false;
  else if (!ctx.calendarConnectedSince) bookingToolsAvailable = false;
  else bookingToolsAvailable = Date.parse(ctx.calendarConnectedSince) <= Date.parse(call.created_at) ? true : false;
  return {
    transcript: call.transcript,
    durationSeconds: call.duration_seconds,
    analysis: call.analysis,
    isInternalTest: call.is_internal_test,
    extractedData: call.extracted_data,
    bookingToolsAvailable,
    toolCalls: null,
    expectsFields: flow ? flow.hasExtractionFields : null,
  };
}

/**
 * Detects and stores issues on one call: analysis.issues is set on top of whatever analysis the row holds now (re-read here, so keys
 * written by the voice engine such as blocked, pilot_limit or expert_backup are kept). Never throws. Returns the issues, or null when
 * nothing could be stored.
 */
export async function detectAndStoreCallIssues(db: Db, call: CallRowForIssues, opts: { retellAgentId?: string | null; tenantContext?: TenantCallContext; dry?: boolean } = {}): Promise<CallIssue[] | null> {
  try {
    const key = call.retell_call_id ? { col: 'retell_call_id', val: call.retell_call_id } : call.id ? { col: 'id', val: call.id } : null;
    if (!key) return null;
    const { data: fresh } = await db.from('calldesk_call_logs').select('analysis').eq(key.col, key.val).maybeSingle();
    const current = asObject(fresh?.analysis ?? call.analysis) ?? {};
    const issues = detectCallIssues(await buildIssueInput(db, { ...call, analysis: current }, opts));
    if (opts.dry) return issues;
    const { error } = await db.from('calldesk_call_logs').update({ analysis: { ...current, issues } }).eq(key.col, key.val);
    if (error) { console.error('[callIssues] store failed:', error.message); return null; }
    return issues;
  } catch (err) {
    console.error('[callIssues] detectAndStoreCallIssues failed:', err);
    return null;
  }
}

export interface BackfillResult { scanned: number; withIssues: number; stored: number; byCode: Record<string, number>; dry: boolean }

/**
 * Scans finished calls from the last 14 days whose analysis has no `issues` key, at most `limit` per run. Only calls older than five
 * minutes with a transcript are taken (a null analysis, i.e. a failed analysis run, is fine), so the voice engine's own end-of-call analysis write cannot race this one. Internal-test
 * and blocked calls are skipped. A scanned call always gets an issues array (possibly empty) so it is not picked again.
 */
export async function backfillCallIssues(db: Db, opts: { limit?: number; dry?: boolean; now?: Date } = {}): Promise<BackfillResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 200));
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const settled = new Date(now.getTime() - 5 * 60_000).toISOString();
  const result: BackfillResult = { scanned: 0, withIssues: 0, stored: 0, byCode: {}, dry: !!opts.dry };
  const { data, error } = await db
    .from('calldesk_call_logs')
    .select('id, tenant_id, retell_call_id, to_number, direction, created_at, duration_seconds, transcript, extracted_data, analysis, is_internal_test')
    .gte('created_at', since)
    .lte('created_at', settled)
    .not('transcript', 'is', null)
    .neq('is_internal_test', true)
    .is('analysis->issues', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const tenantCtx = new Map<string, TenantCallContext>();
  for (const row of (data ?? []) as CallRowForIssues[]) {
    if (isExcludedFromIssues({ analysis: row.analysis, isInternalTest: row.is_internal_test })) continue;
    result.scanned++;
    let tenantContext: TenantCallContext | undefined;
    if (row.tenant_id) {
      tenantContext = tenantCtx.get(row.tenant_id) ?? (await loadTenantCallContext(db, row.tenant_id));
      tenantCtx.set(row.tenant_id, tenantContext);
    }
    const issues = await detectAndStoreCallIssues(db, row, { tenantContext, dry: opts.dry });
    if (!issues) continue;
    if (!opts.dry) result.stored++;
    if (issues.length) result.withIssues++;
    for (const i of issues) result.byCode[i.code] = (result.byCode[i.code] ?? 0) + 1;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Aggregation for the quality-assurance overview

export interface IssueSummaryRow { analysis?: unknown; is_internal_test?: boolean | null; agentKey?: string | null }
export interface IssueSummary {
  callsWithIssues: number;
  totalIssues: number;
  byCode: Array<{ code: IssueCode; severity: IssueSeverity; count: number }>;
  agentCounts: Array<{ agentKey: string; calls: number; issues: number }>;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Counts by issue code and per agent. Blocked pilot calls and internal-test calls are excluded. */
export function summarizeIssues(rows: IssueSummaryRow[]): IssueSummary {
  const byCode = new Map<string, { code: IssueCode; severity: IssueSeverity; count: number }>();
  const agents = new Map<string, { agentKey: string; calls: number; issues: number }>();
  let callsWithIssues = 0;
  let totalIssues = 0;
  for (const r of rows) {
    if (isExcludedFromIssues({ analysis: r.analysis, isInternalTest: r.is_internal_test })) continue;
    const issues = issuesFromAnalysis(r.analysis);
    if (issues.length === 0) continue;
    callsWithIssues++;
    totalIssues += issues.length;
    for (const i of issues) {
      const e = byCode.get(i.code) ?? { code: i.code, severity: i.severity, count: 0 };
      e.count++;
      byCode.set(i.code, e);
    }
    const key = r.agentKey || 'unknown';
    const a = agents.get(key) ?? { agentKey: key, calls: 0, issues: 0 };
    a.calls++;
    a.issues += issues.length;
    agents.set(key, a);
  }
  return {
    callsWithIssues,
    totalIssues,
    byCode: [...byCode.values()].sort((a, b) => b.count - a.count || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    agentCounts: [...agents.values()].sort((a, b) => b.calls - a.calls || b.issues - a.issues),
  };
}

export const ISSUE_LABELS: Record<IssueCode, string> = {
  claimed_booking_without_tool: 'Claimed a booking it could not make',
  placeholder_read_aloud: 'Read a placeholder aloud',
  number_readback_mismatch: 'Phone number read back wrong',
  no_fields_collected: 'No details collected',
  long_silence: 'Long silence',
};
