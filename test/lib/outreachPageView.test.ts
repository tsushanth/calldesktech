import { beforeEach, describe, expect, it } from 'vitest';
import { recordPageView } from '@/lib/outreach/deckEvents';
import { sampleTokenFor } from '@/lib/outreach/samples';

const MSG = '11111111-1111-4111-8111-111111111111';
const tables: Record<string, Record<string, unknown>[]> = {};
const db = { from: (t: string) => {
  const rows = (tables[t] ??= []); const f: [string, unknown][] = []; let since = '';
  const api = {
    select: () => api, eq: (c: string, v: unknown) => { f.push([c, v]); return api; }, gte: (_c: string, v: string) => { since = v; return api; },
    limit: async () => ({ data: rows.filter((r) => f.every(([c, v]) => r[c] === v) && (!since || String(r.created_at) >= since)), error: null }),
    maybeSingle: async () => ({ data: rows.find((r) => f.every(([c, v]) => r[c] === v)) ?? null }),
    insert: async (row: Record<string, unknown>) => { rows.push({ created_at: new Date().toISOString(), ...row }); return { error: null }; },
  };
  return api;
} } as never;

beforeEach(() => { process.env.UNSUBSCRIBE_SECRET = 's'; for (const k of Object.keys(tables)) delete tables[k]; tables.calldesk_outreach_messages = [{ id: MSG, product: 'calldesk:freight' }]; });

describe('recordPageView', () => {
  it('records a deck view with the message product, then dedupes within the hour', async () => {
    const t = sampleTokenFor(MSG);
    expect(await recordPageView(db, { token: t, event: 'view', userAgent: 'Mozilla/5.0 (iPhone)' })).toBe('recorded');
    expect(tables.calldesk_outreach_deck_events[0]).toMatchObject({ message_id: MSG, product: 'calldesk:freight', event: 'view', is_bot: false });
    expect(await recordPageView(db, { token: t, event: 'view', userAgent: 'Mozilla/5.0 (iPhone)' })).toBe('duplicate');
    expect(await recordPageView(db, { token: t, event: 'try_view', userAgent: 'Mozilla/5.0 (iPhone)' })).toBe('recorded');
  });
  it('drops bad tokens and bots', async () => {
    expect(await recordPageView(db, { token: 'bad', event: 'view', userAgent: 'x' })).toBe('invalid_token');
    expect(await recordPageView(db, { token: sampleTokenFor(MSG), event: 'view', userAgent: 'Googlebot/2.1' })).toBe('bot');
    expect(tables.calldesk_outreach_deck_events ?? []).toEqual([]);
  });
});
