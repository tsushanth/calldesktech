// Deliverability summary for the admin console: per product and per autosend lane, how much was sent and how it landed.
// Pure functions over already-fetched rows so the numbers are easy to test; the API route does the fetching.
//
// "Hard bounce" follows autosend's health rule (autosend.ts healthProblem): a bounce whose detail.type is not "transient".
// Transient bounces are counted separately and never feed the bounce rate.

export interface SentMessage { id: string; product: string | null; sent_at: string }
export interface MailEvent { message_id: string | null; event: string; detail?: { type?: string } | null }

export interface Counts {
  sentAll: number; sent24h: number; sent7d: number;
  delivered7d: number; hardBounced7d: number; softBounced7d: number; complained7d: number; delayed7d: number;
  hardBouncedAll: number; complainedAll: number;
  bounceRate7d: number | null; // hard bounces / sent in the last 7 days, null when nothing was sent
}
export interface ProductRow extends Counts { product: string; lane: Lane }
export type Lane = 'calldesk' | 'kk' | 'readaloud';
export interface LaneHealth extends Counts {
  lane: Lane; threshold: number; minSample: number;
  state: 'ok' | 'paused' | 'watch' | 'idle'; reason: string | null;
}

const DAY = 86_400_000;

export function laneOf(product: string | null): Lane {
  const p = product ?? 'calldesk';
  if (p.startsWith('readaloud')) return 'readaloud';
  if (p.startsWith('kreativekoala')) return 'kk';
  return 'calldesk';
}

const empty = (): Counts => ({
  sentAll: 0, sent24h: 0, sent7d: 0, delivered7d: 0, hardBounced7d: 0, softBounced7d: 0, complained7d: 0, delayed7d: 0,
  hardBouncedAll: 0, complainedAll: 0, bounceRate7d: null,
});

/** Per-message outcome flags from its events. */
function flagsByMessage(events: MailEvent[]) {
  const m = new Map<string, { delivered: boolean; hard: boolean; soft: boolean; complained: boolean; delayed: boolean }>();
  for (const e of events) {
    if (!e.message_id) continue;
    const f = m.get(e.message_id) ?? { delivered: false, hard: false, soft: false, complained: false, delayed: false };
    if (e.event === 'delivered') f.delivered = true;
    else if (e.event === 'complained') f.complained = true;
    else if (e.event === 'delivery_delayed') f.delayed = true;
    else if (e.event === 'bounced') {
      if (String(e.detail?.type ?? '').toLowerCase() === 'transient') f.soft = true; else f.hard = true;
    }
    m.set(e.message_id, f);
  }
  return m;
}

function add(c: Counts, msg: SentMessage, f: ReturnType<typeof flagsByMessage> extends Map<string, infer V> ? V | undefined : never, now: number) {
  const age = now - new Date(msg.sent_at).getTime();
  c.sentAll++;
  if (f?.hard) c.hardBouncedAll++;
  if (f?.complained) c.complainedAll++;
  if (age <= DAY) c.sent24h++;
  if (age <= 7 * DAY) {
    c.sent7d++;
    if (f?.delivered) c.delivered7d++;
    if (f?.hard) c.hardBounced7d++;
    if (f?.soft) c.softBounced7d++;
    if (f?.complained) c.complained7d++;
    if (f?.delayed) c.delayed7d++;
  }
}

const finish = (c: Counts): Counts => ({ ...c, bounceRate7d: c.sent7d ? c.hardBounced7d / c.sent7d : null });

export function computeDeliverability(
  messages: SentMessage[], events: MailEvent[], opts: { now?: number; maxBounce?: number; minSample?: number } = {},
): { overall: Counts; products: ProductRow[]; lanes: LaneHealth[] } {
  const now = opts.now ?? Date.now();
  const maxBounce = opts.maxBounce ?? 0.05;
  const minSample = opts.minSample ?? 20; // autosend only pauses once a lane has this many sends in 7 days
  const flags = flagsByMessage(events);
  const overall = empty();
  const byProduct = new Map<string, Counts>();
  const byLane = new Map<Lane, Counts>();
  for (const msg of messages) {
    const f = flags.get(msg.id);
    const key = msg.product ?? 'calldesk';
    const lane = laneOf(msg.product);
    if (!byProduct.has(key)) byProduct.set(key, empty());
    if (!byLane.has(lane)) byLane.set(lane, empty());
    add(overall, msg, f, now); add(byProduct.get(key)!, msg, f, now); add(byLane.get(lane)!, msg, f, now);
  }
  const products: ProductRow[] = [...byProduct.entries()]
    .map(([product, c]) => ({ product, lane: laneOf(product), ...finish(c) }))
    .sort((a, b) => b.sent7d - a.sent7d || b.sentAll - a.sentAll);
  const lanes: LaneHealth[] = (['calldesk', 'kk', 'readaloud'] as Lane[]).map((lane) => {
    const c = finish(byLane.get(lane) ?? empty());
    let state: LaneHealth['state'] = 'ok'; let reason: string | null = null;
    if (c.complained7d > 0) { state = 'paused'; reason = `${c.complained7d} spam complaint(s) in the last 7 days`; }
    else if (c.sent7d >= minSample && c.bounceRate7d !== null && c.bounceRate7d >= maxBounce) { state = 'paused'; reason = `hard bounce rate ${(100 * c.bounceRate7d).toFixed(1)}% (${c.hardBounced7d} of ${c.sent7d}) is at or above the ${(100 * maxBounce).toFixed(1)}% pause threshold`; }
    else if (c.sent7d < minSample && c.hardBounced7d > 0) { state = 'watch'; reason = `only ${c.sent7d} sends in 7 days; auto-pause needs ${minSample}`; }
    else if (c.sent7d === 0) { state = 'idle'; }
    return { lane, threshold: maxBounce, minSample, state, reason, ...c };
  });
  return { overall: finish(overall), products, lanes };
}
