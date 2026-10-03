// ra-yc-media: active Y Combinator companies in the audio-by-default segments
// that ra-yc-voice does not cover: education / e-learning / language learning,
// gaming, media / publishing / podcasts / audiobooks, audio and
// dubbing/localisation, accessibility. Same static mirror as ycVoice.ts
// (yc-oss.github.io, ONE request, parsed in memory), so it adds no requests
// beyond what ra-yc-voice already makes. The company's own one-liner is the
// description.
//
// No double-insert with ra-yc-voice: a company that ra-yc-voice would produce is
// left to it (never emitted here), and the lead key is the same
// `readaloud:yc:<slug>` so, if both ever land, import.ts matches by key/domain
// and MERGES this source's facts into the existing lead instead of inserting.

import { clip, countryOf, emptyResult, isVendorHost, orgDomain, reject, type RaHttp, type RaLead, type RaLoadResult } from './common';
import { YC_ALL_URL, evaluateYcCompany, type YcCompany } from './ycVoice';

export type YcSegment = 'education' | 'gaming' | 'media' | 'audio' | 'accessibility';

// Words in the company's own description that mean audio is (or could be) part
// of the product.
const AUDIO_TEXT = /(\baudio\b|audiobooks?|podcasts?|narrat(ion|or|ed)|voice-?overs?|\bdubb(ing|ed)\b|translat(ion|e)s? of (video|content)|locali[sz](ation|e|ing)|read[- ]aloud|\baccessibility\b|screen[- ]readers?|dyslexi|visually impaired|captions?|transcri(be|bing|ption)|language learning|learn(ing)? (a )?(new )?languages?|\bESL\b|pronunciation|spoken)/i;
// Tight on purpose: "accessible" ("making X accessible") and "blind" ("blind spots") are everywhere. Checked against the one-liner only.
const ACCESS_TEXT = /(\baccessibility\b|screen[- ]readers?|dyslexi|visually[- ]impaired|hearing[- ]impaired|\bdeaf\b|\bblind (users|people|and low)|assistive tech)/i;
const LANG_TEXT = /(language learning|learn(ing)? (a )?(new )?languages?|\bESL\b|pronunciation|tutor(ing)? .*language)/i;
const EDU_TAGS = /^(education|elearning|e-learning|ai-enhanced learning|edtech|language learning)$/i;
const EDU_INDUSTRIES = /^education$/i;
const GAME_TAGS = /^(gaming|cloud gaming|games|video games|esports)$/i;
const GAME_INDUSTRIES = /^gaming$/i;
const MEDIA_TAGS = /^(podcasts|media|publishing|audiobooks|news|entertainment|creator economy|music)$/i;
const AUDIO_TAGS = /^(audio|podcasts|audiobooks)$/i;
// Betting / gambling is not a game studio.
const NOT_GAMES = /(sports? betting|gambling|casino|poker|\bcrypto\b|\bnft\b|play-to-earn)/i;

export type YcMediaMatch = { keep: true; adjust: number; reasons: string[]; segments: YcSegment[]; matched: string } | { keep: false; reason: string };

export function evaluateYcMedia(c: YcCompany): YcMediaMatch {
  if (c.status !== 'Active' && c.status !== 'Public') return { keep: false, reason: 'inactive' };
  // Voice/speech companies belong to ra-yc-voice (which owns their key and score).
  if (evaluateYcCompany(c).keep) return { keep: false, reason: 'owned by ra-yc-voice' };
  const tags = (c.tags ?? []).map(String);
  const industries = (c.industries ?? []).map(String);
  const text = [c.one_liner, c.long_description].filter(Boolean).join(' ');
  const oneLiner = c.one_liner ?? '';
  const segments = new Set<YcSegment>();
  let matched = '';
  const hit = (s: YcSegment, why: string) => { segments.add(s); matched ||= why; };

  const eduTag = tags.find((t) => EDU_TAGS.test(t)) ?? industries.find((t) => EDU_INDUSTRIES.test(t));
  if (eduTag || LANG_TEXT.test(oneLiner)) hit('education', eduTag ?? 'language learning');
  const gameTag = tags.find((t) => GAME_TAGS.test(t)) ?? industries.find((t) => GAME_INDUSTRIES.test(t));
  if (gameTag && !NOT_GAMES.test(text)) hit('gaming', gameTag);
  const mediaTag = tags.find((t) => MEDIA_TAGS.test(t));
  const audioText = text.match(AUDIO_TEXT)?.[0];
  // A media tag alone (e.g. "Media", "Entertainment") is too broad; it needs an audio hint in the text.
  if (mediaTag && audioText) hit('media', mediaTag);
  const audioTag = tags.find((t) => AUDIO_TAGS.test(t));
  if (audioTag) hit('audio', audioTag);
  if (ACCESS_TEXT.test(oneLiner)) hit('accessibility', oneLiner.match(ACCESS_TEXT)?.[0] ?? 'accessibility');
  // Dubbing / localisation / audiobooks / podcasts in the words themselves, in any industry.
  const strongAudio = oneLiner.match(/(audiobooks?|podcasts?|\bdubb(ing|ed)\b|voice-?overs?|narrat(ion|or)|read[- ]aloud)/i)?.[0];
  if (strongAudio) hit('audio', strongAudio);

  if (!segments.size) return { keep: false, reason: 'not an audio-by-default segment' };
  // Education/gaming by industry alone is a long tail of tutoring marketplaces and game
  // engines: +5. An explicit audio signal in their own words is worth more: +10.
  const audioSignal = !!(audioText || strongAudio || audioTag);
  const reasons: string[] = [];
  let adjust = audioSignal ? 10 : 5;
  reasons.push(`+${adjust}: YC company in ${[...segments].join('/')} (${audioSignal ? 'audio in their own description' : `tagged ${matched}`})`);
  if (c.isHiring) { adjust += 3; reasons.push('+3: YC directory lists them as hiring'); }
  return { keep: true, adjust, reasons, segments: [...segments], matched };
}

export function toYcMediaLead(c: YcCompany, m: Extract<YcMediaMatch, { keep: true }>, domain: string): RaLead {
  return {
    sourceId: 'ra-yc-media',
    sourceKey: `readaloud:yc:${c.slug ?? c.id}`, // same key as ra-yc-voice: import merges, never double-inserts
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
      facts: { batch: c.batch ?? null, country: countryOf(c.all_locations), teamSize: c.team_size ?? null, segments: m.segments, matched: m.matched, ycUrl: c.url ?? null },
    },
  };
}

export function selectYcMediaLeads(companies: YcCompany[]): RaLoadResult {
  const res = emptyResult();
  for (const c of companies) {
    res.scanned++;
    const m = evaluateYcMedia(c);
    if (!m.keep) { reject(res, m.reason); continue; }
    const domain = orgDomain(c.website);
    if (!domain) { reject(res, 'no company website'); continue; }
    if (isVendorHost(domain)) { reject(res, 'speech-API vendor itself'); continue; }
    res.leads.push(toYcMediaLead(c, m, domain));
  }
  return res;
}

export async function loadYcMedia(http: RaHttp): Promise<RaLoadResult> {
  const r = await http.get(YC_ALL_URL, { minDelayMs: 0, maxBytes: 40_000_000 });
  if (!r.ok) { const res = emptyResult(); res.errors.push(`YC directory: ${r.blocked ?? `HTTP ${r.status}`}`); return res; }
  let list: YcCompany[];
  try { list = JSON.parse(r.text) as YcCompany[]; } catch { const res = emptyResult(); res.errors.push('YC directory: invalid JSON'); return res; }
  const res = selectYcMediaLeads(Array.isArray(list) ? list : []);
  res.notes.push(`${res.scanned} YC companies scanned`);
  return res;
}
