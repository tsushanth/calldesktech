import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type TranscriptLine = { speaker: 'caller' | 'agent'; text: string };

export interface OutreachSample {
  id: string;
  product: string;
  title: string | null;
  business_name: string | null;
  disclosure: string;
  audio_path: string | null;
  audio_duration_sec: number | null;
  transcript: TranscriptLine[];
  snippet: number[] | null;
  published: boolean;
  created_at: string | null;
}

export type Variant = 'plain' | 'sample';

const TOKEN_DOMAIN = 'sample:';
const SNIPPET_MAX_LINES = 6;
const SNIPPET_FALLBACK_LINES = 5;
const LINE_MAX_CHARS = 140;

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error('UNSUBSCRIBE_SECRET (or CRON_SECRET) is not configured');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(TOKEN_DOMAIN + payload).digest('hex').slice(0, 32);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Signed per-message token: base64url(messageId).hmac, domain-separated from unsubscribe tokens. */
export function sampleTokenFor(messageId: string): string {
  const payload = Buffer.from(messageId).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySampleToken(token: string): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const id = Buffer.from(payload, 'base64url').toString('utf8');
  return UUID_RE.test(id) ? id : null;
}

const PRODUCT_RE = /^[a-z][a-z0-9_-]{0,31}:[a-z0-9][a-z0-9_-]{0,47}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** 'calldesk:freight' -> 'freight'; null for anything not shaped like a product id. */
export function productSlug(product: string): string | null {
  if (typeof product !== 'string' || !PRODUCT_RE.test(product)) return null;
  return product.split(':')[1];
}

/** 'freight' -> 'calldesk:freight'; null for junk. */
export function productFromSlug(slug: string): string | null {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  return `calldesk:${slug}`;
}

let warned = false;
function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('[outreach/samples] sample lookup failed; falling back to no sample:', err instanceof Error ? err.message : err);
}

export async function getPublishedSample(
  supabase: SupabaseClient,
  product: string,
): Promise<OutreachSample | null> {
  try {
    const { data, error } = await supabase
      .from('calldesk_outreach_samples')
      .select('*')
      .eq('product', product)
      .eq('published', true)
      .limit(1)
      .maybeSingle();
    if (error) {
      warnOnce(error);
      return null;
    }
    return (data as OutreachSample | null) ?? null;
  } catch (err) {
    warnOnce(err);
    return null;
  }
}

export function pickVariant(messageId: string): Variant {
  const mode = (process.env.OUTREACH_SAMPLE_VARIANT || 'ab').trim().toLowerCase();
  if (mode === 'sample' || mode === 'plain') return mode;
  const byte = createHash('sha256').update(messageId).digest()[0];
  return byte % 2 === 0 ? 'sample' : 'plain';
}

export function sampleUrl(baseUrl: string, product: string, token: string): string {
  const slug = productSlug(product);
  if (!slug) throw new Error(`Invalid product id: ${product}`);
  return `${baseUrl.replace(/\/+$/, '')}/samples/${slug}?t=${encodeURIComponent(token)}`;
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.\-]+$/, '') + '…';
}

function validLine(l: unknown): l is TranscriptLine {
  if (!l || typeof l !== 'object') return false;
  const o = l as Record<string, unknown>;
  return (o.speaker === 'caller' || o.speaker === 'agent') && typeof o.text === 'string' && o.text.trim() !== '';
}

export function snippetLines(sample: Pick<OutreachSample, 'transcript' | 'snippet'>): TranscriptLine[] {
  const transcript = Array.isArray(sample.transcript) ? sample.transcript : [];
  let lines: TranscriptLine[] = [];
  const idx = sample.snippet;
  if (Array.isArray(idx) && idx.length > 0) {
    const picked = idx.slice(0, SNIPPET_MAX_LINES).map((i) =>
      Number.isInteger(i) && i >= 0 && i < transcript.length ? transcript[i] : undefined,
    );
    if (picked.every(validLine)) lines = picked as TranscriptLine[];
  }
  if (lines.length === 0) {
    lines = transcript.filter(validLine).slice(0, SNIPPET_FALLBACK_LINES);
  }
  return lines.map((l) => ({ speaker: l.speaker, text: truncate(l.text, LINE_MAX_CHARS) }));
}

const BOT_UA_RE = new RegExp(
  [
    'googlebot', 'google-read-aloud', 'googleimageproxy', 'bingbot', 'bingpreview', 'msnbot', 'yahoo! slurp',
    'duckduckbot', 'baiduspider', 'yandex', 'slackbot', 'slack-imgproxy', 'facebookexternalhit', 'facebot',
    'linkedinbot', 'whatsapp', 'twitterbot', 'telegrambot', 'discordbot', 'skypeuripreview', 'microsoft preview',
    'barracuda', 'proofpoint', 'mimecast', 'symantec', 'trendmicro', 'forcepoint', 'mailscanner',
    'python-requests', 'python-urllib', 'curl/', 'wget', 'go-http-client', 'java/1', 'okhttp', 'axios/', 'node-fetch',
    'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'crawler', 'spider', 'urlscan', 'safelinks', 'linkscanner',
  ].join('|'),
  'i',
);

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true;
  return BOT_UA_RE.test(ua) || /\bbot\b/i.test(ua);
}
