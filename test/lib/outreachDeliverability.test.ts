import { describe, it, expect } from 'vitest';
import { computeDeliverability, laneOf, type MailEvent, type SentMessage } from '@/lib/outreach/deliverability';

const NOW = new Date('2026-10-05T20:00:00Z').getTime();
const h = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
const msg = (id: string, product: string | null, hoursAgo: number): SentMessage => ({ id, product, sent_at: h(hoursAgo) });
const ev = (message_id: string, event: string, type?: string): MailEvent => ({ message_id, event, detail: type ? { type } : null });

describe('laneOf', () => {
  it('maps products to autosend lanes', () => {
    expect(laneOf('calldesk')).toBe('calldesk'); expect(laneOf('calldesk:freight')).toBe('calldesk'); expect(laneOf(null)).toBe('calldesk');
    expect(laneOf('kreativekoala:voxkey')).toBe('kk'); expect(laneOf('readaloud:api')).toBe('readaloud');
  });
});

describe('computeDeliverability', () => {
  it('counts windows and outcomes per product', () => {
    const r = computeDeliverability(
      [msg('a', 'calldesk:freight', 2), msg('b', 'calldesk:freight', 30), msg('c', 'calldesk:freight', 24 * 10), msg('d', 'kreativekoala:voxkey', 1)],
      [ev('a', 'delivered'), ev('b', 'delivered'), ev('b', 'bounced', 'Permanent'), ev('c', 'bounced', 'Permanent'), ev('d', 'delivered')],
      { now: NOW },
    );
    const f = r.products.find((p) => p.product === 'calldesk:freight')!;
    expect(f).toMatchObject({ sentAll: 3, sent24h: 1, sent7d: 2, delivered7d: 2, hardBounced7d: 1, hardBouncedAll: 2 });
    expect(f.bounceRate7d).toBeCloseTo(0.5);
    expect(r.overall.sentAll).toBe(4);
  });
  it('transient bounces are shown but never count as hard', () => {
    const r = computeDeliverability([msg('a', 'calldesk', 1)], [ev('a', 'bounced', 'Transient')], { now: NOW });
    expect(r.overall).toMatchObject({ hardBounced7d: 0, softBounced7d: 1, bounceRate7d: 0 });
  });
  it('a message with no events counts as sent but not delivered', () => {
    const r = computeDeliverability([msg('a', 'calldesk', 1)], [], { now: NOW });
    expect(r.overall).toMatchObject({ sent7d: 1, delivered7d: 0 });
  });
  it('pauses a lane at the threshold only with enough sends, like autosend', () => {
    const many = Array.from({ length: 25 }, (_, i) => msg(`m${i}`, 'calldesk', 5));
    const bounced = [ev('m0', 'bounced', 'Permanent'), ev('m1', 'bounced', 'Permanent'), ev('m2', 'bounced', 'Permanent')];
    const paused = computeDeliverability(many, bounced, { now: NOW, maxBounce: 0.1 }).lanes.find((l) => l.lane === 'calldesk')!;
    expect(paused.state).toBe('paused'); expect(paused.reason).toMatch(/12\.0%/);
    const ok = computeDeliverability(many, bounced.slice(0, 1), { now: NOW, maxBounce: 0.1 }).lanes.find((l) => l.lane === 'calldesk')!;
    expect(ok.state).toBe('ok');
    const few = computeDeliverability(many.slice(0, 10), bounced.slice(0, 2), { now: NOW, maxBounce: 0.1 }).lanes.find((l) => l.lane === 'calldesk')!;
    expect(few.state).toBe('watch');
  });
  it('a spam complaint pauses the lane regardless of volume', () => {
    const l = computeDeliverability([msg('a', 'kreativekoala:gymlog', 1)], [ev('a', 'complained')], { now: NOW }).lanes.find((x) => x.lane === 'kk')!;
    expect(l.state).toBe('paused');
  });
  it('lanes with no sends are idle', () => {
    const l = computeDeliverability([], [], { now: NOW }).lanes.find((x) => x.lane === 'readaloud')!;
    expect(l.state).toBe('idle');
  });
});
