import { isBotUserAgent, verifySampleToken } from './samples';

export type SampleEventName = 'view' | 'play' | 'complete';
export const SAMPLE_EVENTS: readonly SampleEventName[] = ['view', 'play', 'complete'];
export const VIEW_DEDUPE_MS = 60 * 60 * 1000;

export function isClientEvent(e: unknown): e is 'play' | 'complete' {
  return e === 'play' || e === 'complete';
}

export interface SampleEventDeps {
  /** Message row context; null if unknown or lookup failed. */
  getMessage(messageId: string): Promise<{ sample_id: string | null; product: string | null } | null>;
  /** True if an event of this kind exists for the message (since `sinceIso` when given). */
  hasEvent(messageId: string, event: SampleEventName, sinceIso?: string): Promise<boolean>;
  insert(row: { message_id: string; sample_id: string | null; product: string | null; event: SampleEventName; is_bot: boolean }): Promise<void>;
  now?: () => number;
}

export type RecordResult = 'recorded' | 'bot' | 'invalid_token' | 'invalid_event' | 'duplicate' | 'error';

/**
 * Validate + dedupe + insert one event. Never throws. `view` dedupes per
 * message per hour; play/complete once per message ever. Bots are dropped
 * (not stored), no IP is ever read.
 */
export async function recordSampleEvent(
  deps: SampleEventDeps,
  input: { token: unknown; event: unknown; userAgent: string | null | undefined; sampleId?: string | null; product?: string | null },
): Promise<RecordResult> {
  if (typeof input.event !== 'string' || !SAMPLE_EVENTS.includes(input.event as SampleEventName)) return 'invalid_event';
  const event = input.event as SampleEventName;
  let messageId: string | null = null;
  try {
    messageId = typeof input.token === 'string' ? verifySampleToken(input.token) : null;
  } catch {
    messageId = null;
  }
  if (!messageId) return 'invalid_token';
  if (isBotUserAgent(input.userAgent)) return 'bot';
  try {
    const now = (deps.now ?? Date.now)();
    const since = event === 'view' ? new Date(now - VIEW_DEDUPE_MS).toISOString() : undefined;
    if (await deps.hasEvent(messageId, event, since)) return 'duplicate';
    const msg = await deps.getMessage(messageId);
    await deps.insert({
      message_id: messageId,
      sample_id: msg?.sample_id ?? input.sampleId ?? null,
      product: input.product ?? msg?.product ?? null,
      event,
      is_bot: false,
    });
    return 'recorded';
  } catch (err) {
    console.warn('[outreach/sample-events] record failed:', err instanceof Error ? err.message : err);
    return 'error';
  }
}

// ---- stats ----

export interface StatsMessage { id: string; product: string | null; variant: string | null; sample_id: string | null; replied: boolean }
export interface StatsEvent { message_id: string | null; event: string; is_bot?: boolean | null }
export interface StatsRow {
  product: string;
  variant: 'plain' | 'sample';
  sent: number;
  viewed: number;
  played: number;
  completed: number;
  viewRate: number | null;
  replies: number;
  replyRate: number | null;
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** `productOf` optionally maps sample_id -> sample product (e.g. calldesk:freight). */
export function computeSampleStats(
  messages: StatsMessage[],
  events: StatsEvent[],
  sampleProducts: Record<string, string> = {},
): StatsRow[] {
  const byMsg = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.message_id || e.is_bot) continue;
    if (!byMsg.has(e.message_id)) byMsg.set(e.message_id, new Set());
    byMsg.get(e.message_id)!.add(e.event);
  }
  const rows = new Map<string, StatsRow>();
  for (const m of messages) {
    const product = (m.sample_id && sampleProducts[m.sample_id]) || m.product || 'unknown';
    const variant: 'plain' | 'sample' = m.variant === 'sample' ? 'sample' : 'plain';
    const key = `${product}|${variant}`;
    let r = rows.get(key);
    if (!r) {
      r = { product, variant, sent: 0, viewed: 0, played: 0, completed: 0, viewRate: null, replies: 0, replyRate: null };
      rows.set(key, r);
    }
    r.sent++;
    const ev = byMsg.get(m.id);
    if (ev?.has('view')) r.viewed++;
    if (ev?.has('play')) r.played++;
    if (ev?.has('complete')) r.completed++;
    if (m.replied) r.replies++;
  }
  const out = [...rows.values()];
  for (const r of out) {
    r.viewRate = ratio(r.viewed, r.sent);
    r.replyRate = ratio(r.replies, r.sent);
  }
  return out.sort((a, b) => a.product.localeCompare(b.product) || a.variant.localeCompare(b.variant));
}
