// ra-yc-voice: active Y Combinator companies building voice / speech / TTS /
// IVR / call-centre / conversational-voice products, from the community-kept
// static mirror of YC's public directory (yc-oss.github.io, ~10 MB JSON,
// refreshed daily). Parsed in memory, never written to disk. Every entry is a
// company with its own website; the one-liner is the company's own words.

import { clip, countryOf, emptyResult, isVendorHost, orgDomain, reject, type RaHttp, type RaLead, type RaLoadResult } from './common';

export const YC_ALL_URL = 'https://yc-oss.github.io/api/companies/all.json';

export interface YcCompany {
  id?: number; name?: string; slug?: string; website?: string | null; all_locations?: string | null;
  one_liner?: string | null; long_description?: string | null; tags?: string[] | null; industries?: string[] | null;
  batch?: string | null; status?: string | null; team_size?: number | null; isHiring?: boolean | null; url?: string | null;
}

// Phrases that mean a voice/speech PRODUCT (not "voice of the customer" or "brand voice").
const STRONG = /(voice[- ]?(ai|agents?|assistants?|bots?|interfaces?|cloning|clones?|models?|apis?|platforms?|synthesis|recognition|first)\b|speech[- ](to[- ]text|recognition|synthesis|models?|ai|apis?|analytics)|text[- ]to[- ]speech|\btts\b|\basr\b|\bivr\b|call[- ]cent(er|re)s?|contact[- ]cent(er|re)s?|conversational voice|phone (agents?|calls?)|ai receptionists?|dubbing|voice-based|voice-enabled|spoken language)/i;
const NOISE = /voice of (the )?customers?|brand voice|voice of your brand|tone of voice/gi;
const SPEECH_TAGS = /^(speech recognition|call center|voice|voice ai|text-to-speech|audio ai)$/i;

export type YcMatch = { keep: true; adjust: number; reasons: string[]; matched: string } | { keep: false; reason: string };

export function evaluateYcCompany(c: YcCompany): YcMatch {
  if (c.status !== 'Active' && c.status !== 'Public') return { keep: false, reason: `status ${c.status ?? 'unknown'}` };
  const tags = (c.tags ?? []).map(String);
  const text = [c.one_liner, c.long_description].filter(Boolean).join(' ').replace(NOISE, ' ');
  const tagHit = tags.find((t) => SPEECH_TAGS.test(t));
  const textHit = text.match(STRONG)?.[0];
  // "Conversational AI" alone is mostly text chatbots: needs a voice word too.
  const convHit = tags.some((t) => /^conversational ai$/i.test(t)) && /\b(voice|speech|phone|calls?|audio|spoken)\b/i.test(text);
  if (!tagHit && !textHit && !convHit) return { keep: false, reason: 'not voice/speech' };
  const reasons = ['+10: YC company building a voice/speech product'];
  let adjust = 10;
  if (c.isHiring) { adjust += 3; reasons.push('+3: YC directory lists them as hiring'); }
  return { keep: true, adjust, reasons, matched: tagHit ?? textHit ?? 'Conversational AI + voice' };
}

export function toYcLead(c: YcCompany, m: Extract<YcMatch, { keep: true }>, domain: string): RaLead {
  return {
    sourceId: 'ra-yc-voice',
    sourceKey: `readaloud:yc:${c.slug ?? c.id}`,
    name: clip(c.name, 120) as string,
    domain,
    location: clip(c.all_locations, 200),
    description: clip(c.one_liner, 300),
    signalSource: 'directory',
    signalDetail: clip(`Y Combinator ${c.batch ?? ''}: ${c.one_liner ?? ''}`, 280) as string,
    email: null,
    emailSourceUrl: null,
    source: {
      adjust: m.adjust,
      reasons: m.reasons,
      facts: { batch: c.batch ?? null, country: countryOf(c.all_locations), teamSize: c.team_size ?? null, matched: m.matched, ycUrl: c.url ?? null },
    },
  };
}

export function selectYcLeads(companies: YcCompany[]): RaLoadResult {
  const res = emptyResult();
  for (const c of companies) {
    res.scanned++;
    const m = evaluateYcCompany(c);
    if (!m.keep) { reject(res, m.reason === 'not voice/speech' ? m.reason : 'inactive'); continue; }
    const domain = orgDomain(c.website);
    if (!domain) { reject(res, 'no company website'); continue; }
    if (isVendorHost(domain)) { reject(res, 'speech-API vendor itself'); continue; }
    res.leads.push(toYcLead(c, m, domain));
  }
  return res;
}

export async function loadYcVoice(http: RaHttp): Promise<RaLoadResult> {
  const r = await http.get(YC_ALL_URL, { minDelayMs: 0, maxBytes: 40_000_000 });
  if (!r.ok) { const res = emptyResult(); res.errors.push(`YC directory: ${r.blocked ?? `HTTP ${r.status}`}`); return res; }
  let list: YcCompany[];
  try { list = JSON.parse(r.text) as YcCompany[]; } catch { const res = emptyResult(); res.errors.push('YC directory: invalid JSON'); return res; }
  const res = selectYcLeads(Array.isArray(list) ? list : []);
  res.notes.push(`${res.scanned} YC companies scanned`);
  return res;
}
