import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sampleTokenFor } from '@/lib/outreach/samples';
import { recordSampleEvent, computeSampleStats, type SampleEventDeps } from '@/lib/outreach/sampleEvents';

const MSG = '11111111-1111-4111-8111-111111111111';
const UA = 'Mozilla/5.0 (iPhone) Safari/604.1';
beforeAll(() => { process.env.UNSUBSCRIBE_SECRET = 'test-secret'; });

function deps(over: Partial<SampleEventDeps> = {}) {
  const inserted: unknown[] = [];
  const d: SampleEventDeps = {
    getMessage: async () => ({ sample_id: 's1', product: 'calldesk' }),
    hasEvent: async () => false,
    insert: async (r) => { inserted.push(r); },
    ...over,
  };
  return { d, inserted };
}

describe('recordSampleEvent', () => {
  it('records a valid play', async () => {
    const { d, inserted } = deps();
    expect(await recordSampleEvent(d, { token: sampleTokenFor(MSG), event: 'play', userAgent: UA })).toBe('recorded');
    expect(inserted).toEqual([{ message_id: MSG, sample_id: 's1', product: 'calldesk', event: 'play', is_bot: false }]);
  });
  it('ignores bots', async () => {
    const { d, inserted } = deps();
    expect(await recordSampleEvent(d, { token: sampleTokenFor(MSG), event: 'view', userAgent: 'Googlebot/2.1' })).toBe('bot');
    expect(await recordSampleEvent(d, { token: sampleTokenFor(MSG), event: 'view', userAgent: null })).toBe('bot');
    expect(inserted).toHaveLength(0);
  });
  it('ignores invalid tokens', async () => {
    const { d, inserted } = deps();
    expect(await recordSampleEvent(d, { token: 'junk', event: 'play', userAgent: UA })).toBe('invalid_token');
    expect(await recordSampleEvent(d, { token: undefined, event: 'play', userAgent: UA })).toBe('invalid_token');
    expect(inserted).toHaveLength(0);
  });
  it('rejects unknown events', async () => {
    const { d } = deps();
    expect(await recordSampleEvent(d, { token: sampleTokenFor(MSG), event: 'click', userAgent: UA })).toBe('invalid_event');
  });
  it('dedupes; views use a 1h window, plays do not', async () => {
    const seen: Array<string | undefined> = [];
    const { d, inserted } = deps({ hasEvent: async (_m, _e, since) => { seen.push(since); return true; }, now: () => 1_000_000_000_000 });
    expect(await recordSampleEvent(d, { token: sampleTokenFor(MSG), event: 'view', userAgent: UA })).toBe('duplicate');
    expect(await recordSampleEvent(d, { token: sampleTokenFor(MSG), event: 'play', userAgent: UA })).toBe('duplicate');
    expect(seen[0]).toBe(new Date(1_000_000_000_000 - 3600_000).toISOString());
    expect(seen[1]).toBeUndefined();
    expect(inserted).toHaveLength(0);
  });
  it('swallows DB errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { d } = deps({ insert: async () => { throw new Error('relation does not exist'); } });
    expect(await recordSampleEvent(d, { token: sampleTokenFor(MSG), event: 'play', userAgent: UA })).toBe('error');
  });
});

describe('computeSampleStats', () => {
  it('aggregates per product and variant, ignoring bots and duplicates', () => {
    const rows = computeSampleStats(
      [
        { id: 'a', product: 'calldesk', variant: 'sample', sample_id: 's1', replied: true },
        { id: 'b', product: 'calldesk', variant: 'sample', sample_id: 's1', replied: false },
        { id: 'c', product: 'calldesk', variant: 'plain', sample_id: null, replied: false },
        { id: 'd', product: 'calldesk', variant: null, sample_id: null, replied: true },
      ],
      [
        { message_id: 'a', event: 'view' }, { message_id: 'a', event: 'view' },
        { message_id: 'a', event: 'play' }, { message_id: 'a', event: 'complete' },
        { message_id: 'b', event: 'view', is_bot: true },
      ],
      { s1: 'calldesk:freight' },
    );
    const s = rows.find((r) => r.variant === 'sample')!;
    expect(s).toMatchObject({ product: 'calldesk:freight', sent: 2, viewed: 1, played: 1, completed: 1, viewRate: 0.5, replies: 1, replyRate: 0.5 });
    const p = rows.find((r) => r.variant === 'plain')!;
    expect(p).toMatchObject({ product: 'calldesk', sent: 2, viewed: 0, viewRate: 0, replies: 1 });
  });
  it('handles empty input without dividing by zero', () => {
    expect(computeSampleStats([], [])).toEqual([]);
  });
});
