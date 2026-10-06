import { politeFetchText } from './http';
import { hostOf } from './findDomain';

// Vapi's public partner directory (their own marketing page, hosted on partnerpage.io). Service partners are agencies
// that build and deliver voice agents on Vapi for their customers: the same audience as Retell's directory.
// The page ships its listing inside a Nuxt payload (a flat array where objects point at each other by index), so
// there is no HTML to scrape; parseVapiPartners resolves that payload and keeps the entries that have a website.

export interface VapiPartner {
  slug: string;
  name: string;
  domain: string;
  headline: string | null;
  description: string | null;
}

const BASE = 'https://vapi.ai/partnerships/directory';

// Technology partners are the infrastructure Vapi plugs into (cloud, models, telephony, speech): not agencies, and several
// are the vendors we compete with on speech. Dropped by host.
const NOT_AGENCIES = [
  'amazon.com', 'aws.amazon.com', 'google.com', 'cloud.google.com', 'microsoft.com', 'azure.microsoft.com', 'openai.com', 'anthropic.com',
  'deepgram.com', 'elevenlabs.io', 'cartesia.ai', 'assemblyai.com', 'groq.com', 'twilio.com', 'telnyx.com', 'vonage.com', 'plivo.com',
  'deepseek.com', 'mistral.ai', 'together.ai', 'openrouter.ai', 'playht.com', 'play.ht', 'rime.ai', 'lmnt.com', 'hume.ai', 'azure.com',
  'cloudflare.com', 'vercel.com', 'supabase.com', 'zapier.com', 'make.com', 'n8n.io', 'hubspot.com', 'salesforce.com', 'gohighlevel.com',
  'livekit.io', 'daily.co', 'speechmatics.com', 'gladia.io', 'neuphonic.com', 'inworld.ai', 'fireworks.ai', 'cerebras.ai', 'x.ai',
];

const WRAPPERS = new Set(['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef']);

function strip(html: unknown): string | null {
  if (typeof html !== 'string') return null;
  const t = html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 500) : null;
}

/** Pure: partners from one page of the directory. Returns [] for a page with no payload. */
export function parseVapiPartners(html: string): VapiPartner[] {
  const m = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return [];
  let arr: unknown[];
  try { arr = JSON.parse(m[1]) as unknown[]; } catch { return []; }
  if (!Array.isArray(arr)) return [];

  const memo = new Map<number, unknown>();
  const res = (i: unknown, depth = 0): unknown => {
    if (typeof i !== 'number' || depth > 40) return i;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (v === null || typeof v !== 'object') { memo.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && WRAPPERS.has(v[0])) { const r = res(v[1], depth + 1); memo.set(i, r); return r; }
      const out: unknown[] = []; memo.set(i, out);
      for (const x of v) out.push(res(x, depth + 1));
      return out;
    }
    const out: Record<string, unknown> = {}; memo.set(i, out);
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = res(x, depth + 1);
    return out;
  };

  const seen = new Set<object>();
  const found: Record<string, unknown>[] = [];
  const walk = (o: unknown, depth = 0) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 14) return;
    seen.add(o);
    const rec = o as Record<string, unknown>;
    if (!Array.isArray(o) && typeof rec.title === 'string' && typeof rec.website === 'string' && typeof rec.slug === 'string') found.push(rec);
    for (const v of Array.isArray(o) ? o : Object.values(rec)) walk(v, depth + 1);
  };
  walk(res(0));

  const out: VapiPartner[] = [];
  const slugs = new Set<string>();
  for (const f of found) {
    const slug = String(f.slug);
    const domain = hostOf(String(f.website))?.replace(/^www\./, '') ?? '';
    if (!domain || slugs.has(slug)) continue;
    if (NOT_AGENCIES.some((h) => domain === h || domain.endsWith(`.${h}`))) continue;
    slugs.add(slug);
    out.push({ slug, name: String(f.title).slice(0, 120), domain, headline: strip(f.headline), description: strip(f.description) });
  }
  return out;
}

/** Walks the directory pages until one adds nothing new. One polite request per page. */
export async function fetchVapiPartners(maxPages = 12): Promise<VapiPartner[]> {
  const all = new Map<string, VapiPartner>();
  for (let page = 1; page <= maxPages; page++) {
    const res = await politeFetchText(`${BASE}?page=${page}`, 25000);
    if (!res.ok) { if (page === 1) throw new Error(`Vapi partner directory request failed: ${res.status}`); break; }
    const before = all.size;
    for (const p of parseVapiPartners(res.text)) if (!all.has(p.slug)) all.set(p.slug, p);
    if (all.size === before) break;
  }
  return [...all.values()];
}
