import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sampleTokenFor,
  verifySampleToken,
  productSlug,
  productFromSlug,
  getPublishedSample,
  pickVariant,
  sampleUrl,
  snippetLines,
  isBotUserAgent,
} from '@/lib/outreach/samples';
import { makeUnsubscribeToken } from '@/lib/outreach/unsubscribe';

const ID = '3f2b8c1e-6d4a-4f7e-9a10-2b5c7d8e9f01';
const ENV_KEYS = ['UNSUBSCRIBE_SECRET', 'CRON_SECRET', 'OUTREACH_SAMPLE_VARIANT'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.UNSUBSCRIBE_SECRET = 'test-secret';
  delete process.env.OUTREACH_SAMPLE_VARIANT;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('sample tokens', () => {
  it('round-trips and is URL safe', () => {
    const t = sampleTokenFor(ID);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]+$/);
    expect(verifySampleToken(t)).toBe(ID);
  });
  it('rejects tampering and wrong secret', () => {
    const t = sampleTokenFor(ID);
    const [p, s] = t.split('.');
    expect(verifySampleToken(`${p}.${s.replace(/.$/, s.endsWith('0') ? '1' : '0')}`)).toBeNull();
    const other = Buffer.from('3f2b8c1e-6d4a-4f7e-9a10-2b5c7d8e9f02').toString('base64url');
    expect(verifySampleToken(`${other}.${s}`)).toBeNull();
    expect(verifySampleToken('garbage')).toBeNull();
    expect(verifySampleToken('')).toBeNull();
    process.env.UNSUBSCRIBE_SECRET = 'different';
    expect(verifySampleToken(t)).toBeNull();
  });
  it('does not accept an unsubscribe token', () => {
    expect(verifySampleToken(makeUnsubscribeToken(ID))).toBeNull();
  });
  it('falls back to CRON_SECRET', () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    process.env.CRON_SECRET = 'cron';
    expect(verifySampleToken(sampleTokenFor(ID))).toBe(ID);
  });
});

describe('product slugs', () => {
  it('maps both ways', () => {
    expect(productSlug('calldesk:freight')).toBe('freight');
    expect(productFromSlug('freight')).toBe('calldesk:freight');
  });
  it('rejects junk', () => {
    for (const j of ['freight', 'calldesk:', ':x', 'calldesk:a/b', 'calldesk:../x', 'CALLDESK:x', 'a:b:c', '', 'calldesk:x y']) {
      expect(productSlug(j)).toBeNull();
    }
    for (const j of ['', '../x', 'a/b', 'A B', 'x:y', '-x']) expect(productFromSlug(j)).toBeNull();
  });
});

describe('pickVariant', () => {
  it('is deterministic and roughly balanced', () => {
    expect(pickVariant(ID)).toBe(pickVariant(ID));
    let sample = 0;
    for (let i = 0; i < 200; i++) if (pickVariant(`msg-${i}`) === 'sample') sample++;
    expect(sample).toBeGreaterThan(60);
    expect(sample).toBeLessThan(140);
  });
  it('honours env override', () => {
    process.env.OUTREACH_SAMPLE_VARIANT = 'sample';
    expect(pickVariant('a')).toBe('sample');
    process.env.OUTREACH_SAMPLE_VARIANT = 'plain';
    expect(pickVariant('a')).toBe('plain');
    process.env.OUTREACH_SAMPLE_VARIANT = 'ab';
    expect(['plain', 'sample']).toContain(pickVariant('a'));
  });
});

describe('sampleUrl', () => {
  it('builds the url', () => {
    expect(sampleUrl('https://calldesk.tech/', 'calldesk:freight', 'a.b')).toBe('https://calldesk.tech/samples/freight?t=a.b');
  });
});

describe('snippetLines', () => {
  const transcript = Array.from({ length: 10 }, (_, i) => ({
    speaker: (i % 2 ? 'agent' : 'caller') as 'caller' | 'agent',
    text: `line ${i}`,
  }));
  it('resolves indexes and caps at 6', () => {
    const l = snippetLines({ transcript, snippet: [0, 1, 2, 3, 4, 5, 6, 7] });
    expect(l).toHaveLength(6);
    expect(l[2].text).toBe('line 2');
  });
  it('falls back when missing or invalid', () => {
    expect(snippetLines({ transcript, snippet: null })).toHaveLength(5);
    expect(snippetLines({ transcript, snippet: [0, 99] })).toHaveLength(5);
    expect(snippetLines({ transcript, snippet: [] })).toHaveLength(5);
  });
  it('truncates on a word boundary with ellipsis', () => {
    const text = 'word '.repeat(60).trim();
    const [l] = snippetLines({ transcript: [{ speaker: 'agent', text }], snippet: [0] });
    expect(l.text.length).toBeLessThanOrEqual(140);
    expect(l.text.endsWith('…')).toBe(true);
    expect(l.text).toMatch(/word…$/);
  });
});

describe('isBotUserAgent', () => {
  it('flags bots and empty UA', () => {
    for (const ua of [
      '', undefined, null,
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Slackbot-LinkExpanding 1.0',
      'facebookexternalhit/1.1',
      'LinkedInBot/1.0',
      'WhatsApp/2.23',
      'Twitterbot/1.0',
      'Mozilla/5.0 (Windows NT 10.0) Microsoft Preview',
      'Barracuda Sentinel',
      'Proofpoint URL Defense',
      'Mimecast Ltd',
      'python-requests/2.31',
      'curl/8.1.2',
      'Mozilla/5.0 HeadlessChrome/120.0',
    ]) expect(isBotUserAgent(ua as string)).toBe(true);
  });
  it('does not flag realistic human user agents', () => {
    for (const ua of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/618.1.15 (KHTML, like Gecko) Version/17.4 Safari/618.1.15 Safari Technology Preview',
      'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17328; Pro)',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 GSA/15.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GmailApp/6.0',
    ]) expect(isBotUserAgent(ua), ua).toBe(false);
  });
  it('passes real browsers', () => {
    expect(isBotUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe(false);
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')).toBe(false);
  });
});

describe('getPublishedSample', () => {
  it('returns null on a rejecting client', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = { from: () => { throw new Error('relation does not exist'); } } as unknown as SupabaseClient;
    expect(await getPublishedSample(client, 'calldesk:freight')).toBeNull();
  });
  it('returns null on a query error and the row on success', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mk = (res: unknown) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit']) q[m] = () => q;
      q.maybeSingle = () => Promise.resolve(res);
      return { from: () => q } as unknown as SupabaseClient;
    };
    expect(await getPublishedSample(mk({ data: null, error: { message: 'missing' } }), 'calldesk:x')).toBeNull();
    const row = { id: 'r' };
    expect(await getPublishedSample(mk({ data: row, error: null }), 'calldesk:x')).toEqual(row);
  });
});
