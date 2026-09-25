// ra-jobs-signal: companies publicly hiring voice/speech engineers, the
// strongest spend signal (a team hiring for TTS/ASR/voice-agent work is paying
// for speech minutes). Two inputs:
//   1. ATS job boards (public, documented JSON APIs): for each company we
//      already know (existing readaloud leads + the cheap sources + a short
//      seed list of voice-AI companies), probe Greenhouse / Lever / Ashby with
//      slugs derived from its name/domain, verify the board belongs to that
//      company, and keep it if it has open roles whose TITLE matches
//      voice|speech|tts|asr|text-to-speech|voice agent.
//   2. Hacker News "Ask HN: Who is hiring?" (Algolia API): top-level comments
//      (the company's own post) matching voice/speech. Only the company name,
//      the company URL and the company's own one-line pitch are kept; never the
//      poster, never an email address from the comment.
// The result is a fact on the lead (jobs count + titles) and a score bump. For
// a company that is already a readaloud lead, the importer MERGES this fact
// into that lead rather than creating a second one.

import { clip, decodeEntities, emptyResult, isVendorHost, nameFromDomain, orgDomain, parseJson, reject, stripTags, type RaHttp, type RaLead, type RaLoadResult } from './common';
import { compactName } from '../dedupe';

export const VOICE_ROLE = /\b(voice|speech|tts|asr|text[- ]to[- ]speech|speech[- ]to[- ]text|voice[- ]agents?|conversational ai|audio (ml|ai|machine learning)|speech recognition|dialog(ue)? systems?)\b/i;

export type Ats = 'greenhouse' | 'lever' | 'ashby';
export interface AtsJob { title: string; url: string | null; text: string }
export interface Company { name: string; domain: string; ats?: { ats: Ats; slug: string } }

// Known voice-AI builders with verified public boards (checked 2026-09-25).
// Speech-API vendors themselves (ElevenLabs, Cartesia, Deepgram, Speechmatics,
// Rime, Gladia, WellSaid) are excluded: they are competitors, not customers.
export const SEED_COMPANIES: Company[] = [
  { name: 'Vapi', domain: 'vapi.ai', ats: { ats: 'ashby', slug: 'vapi' } },
  { name: 'Bland AI', domain: 'bland.ai', ats: { ats: 'ashby', slug: 'bland' } },
  { name: 'LiveKit', domain: 'livekit.io', ats: { ats: 'ashby', slug: 'livekit' } },
  { name: 'Retell AI', domain: 'retellai.com', ats: { ats: 'ashby', slug: 'retell-ai' } },
  { name: 'PolyAI', domain: 'poly.ai', ats: { ats: 'greenhouse', slug: 'polyai' } },
  { name: 'Cresta', domain: 'cresta.com', ats: { ats: 'greenhouse', slug: 'cresta' } },
  { name: 'Observe.AI', domain: 'observe.ai', ats: { ats: 'greenhouse', slug: 'observeai' } },
  { name: 'Sierra', domain: 'sierra.ai', ats: { ats: 'ashby', slug: 'sierra' } },
  { name: 'Decagon', domain: 'decagon.ai', ats: { ats: 'ashby', slug: 'decagon' } },
  { name: 'Assort Health', domain: 'assorthealth.com', ats: { ats: 'ashby', slug: 'assorthealth' } },
  { name: 'HelloPatient', domain: 'hellopatient.com', ats: { ats: 'ashby', slug: 'hellopatient' } },
  { name: 'Descript', domain: 'descript.com', ats: { ats: 'greenhouse', slug: 'descript' } },
];

// Slugs to try for a company: compact name, hyphenated name, domain label.
// Short (<4 char) slugs are skipped: too likely to be someone else's board.
export function atsSlugs(name: string, domain: string): string[] {
  const clean = name.toLowerCase().replace(/[™®©]/g, '').replace(/\b(inc|llc|ltd|gmbh|corp|co)\b\.?/g, '').trim();
  const compact = compactName(name);
  const hyphen = clean.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const label = domain.split('.')[0].replace(/[^a-z0-9-]/g, '');
  return [...new Set([compact, hyphen, label])].filter((s) => s.length >= 4).slice(0, 3);
}

export function atsUrl(ats: Ats, slug: string): string {
  if (ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  if (ats === 'lever') return `https://api.lever.co/v0/postings/${slug}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
}

export function parseAtsJobs(ats: Ats, text: string): AtsJob[] | null {
  const j = parseJson<unknown>(text);
  if (!j) return null;
  if (ats === 'greenhouse') {
    const jobs = (j as { jobs?: { title?: string; absolute_url?: string; content?: string }[] }).jobs;
    return Array.isArray(jobs) ? jobs.map((x) => ({ title: String(x.title ?? ''), url: x.absolute_url ?? null, text: stripTags(decodeEntities(String(x.content ?? ''))).slice(0, 4000) })) : null;
  }
  if (ats === 'lever') {
    return Array.isArray(j) ? (j as { text?: string; hostedUrl?: string; descriptionPlain?: string }[]).map((x) => ({ title: String(x.text ?? ''), url: x.hostedUrl ?? null, text: String(x.descriptionPlain ?? '').slice(0, 4000) })) : null;
  }
  const jobs = (j as { jobs?: { title?: string; jobUrl?: string; isListed?: boolean; descriptionPlain?: string }[] }).jobs;
  return Array.isArray(jobs) ? jobs.filter((x) => x.isListed !== false).map((x) => ({ title: String(x.title ?? ''), url: x.jobUrl ?? null, text: String(x.descriptionPlain ?? '').slice(0, 4000) })) : null;
}

// A derived slug can belong to a different company with the same word. The
// board counts as theirs only if some posting mentions their name or domain.
export function boardBelongsTo(jobs: AtsJob[], company: Company): boolean {
  const label = company.domain.split('.')[0].toLowerCase();
  const name = company.name.toLowerCase();
  return jobs.some((j) => {
    const t = j.text.toLowerCase();
    return t.includes(company.domain.toLowerCase()) || (name.length >= 4 && t.includes(name)) || (label.length >= 5 && t.includes(label));
  });
}

export function matchVoiceRoles(jobs: AtsJob[]): AtsJob[] {
  return jobs.filter((j) => VOICE_ROLE.test(j.title));
}

export interface JobsFact { ats?: { ats: Ats; slug: string; openRoles: number; voiceRoles: number; titles: string[] }; hn?: { item: string; thread: string } }

export function jobsAdjust(f: JobsFact): { adjust: number; reasons: string[] } {
  const reasons: string[] = [];
  let adjust = 0;
  if (f.ats && f.ats.voiceRoles > 0) {
    adjust += 15; reasons.push(`+15: hiring for ${f.ats.voiceRoles} voice/speech role(s) on ${f.ats.ats}`);
    if (f.ats.voiceRoles >= 3) { adjust += 5; reasons.push('+5: 3+ open voice/speech roles'); }
  }
  if (f.hn) { const d = f.ats ? 5 : 12; adjust += d; reasons.push(`+${d}: posted a voice/speech role in HN "${f.hn.thread}"`); }
  return { adjust, reasons };
}

export function toJobsLead(company: { name: string; domain: string; description?: string | null }, f: JobsFact): RaLead {
  const { adjust, reasons } = jobsAdjust(f);
  const titles = f.ats?.titles ?? [];
  return {
    sourceId: 'ra-jobs-signal',
    sourceKey: `readaloud:jobs:${company.domain}`,
    name: clip(company.name, 120) as string,
    domain: company.domain,
    location: null,
    description: clip(company.description ?? null, 300),
    signalSource: 'job_posting',
    signalDetail: clip(f.ats ? `Hiring (${f.ats.ats}): ${titles.slice(0, 3).join('; ')}` : `HN ${f.hn?.thread ?? 'Who is hiring'}: voice/speech role`, 280) as string,
    email: null,
    emailSourceUrl: null,
    source: { adjust, reasons, facts: { ...f } },
  };
}

// ---- Hacker News "Who is hiring?" ------------------------------------------

export interface HnHit { objectID: string; parent_id?: number | null; story_id?: number | null; comment_text?: string | null; story_title?: string | null; title?: string | null; url?: string | null; points?: number | null; created_at?: string }

// A top-level hiring comment is "Company | URL | Role | Location ...<p>pitch".
export function parseHiringComment(hit: HnHit): { name: string; domain: string; pitch: string | null } | null {
  if (!hit.comment_text || hit.parent_id == null || hit.parent_id !== hit.story_id) return null; // replies are people, not companies
  const html = hit.comment_text;
  const firstPara = html.split(/<p>/i)[0];
  const header = stripTags(firstPara);
  const rawName = header.split('|')[0].replace(/\(.*?\)/g, '').trim();
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
  const texts = [...stripTags(firstPara).matchAll(/\bhttps?:\/\/[^\s|]+|\b[a-z0-9-]+\.(?:ai|com|io|co|dev|app|tech|org|net)\b/gi)].map((m) => m[0]);
  let domain: string | null = null;
  for (const u of [...hrefs, ...texts]) {
    const d = orgDomain(u);
    if (d && !isVendorHost(d)) { domain = d; break; }
  }
  if (!domain || !rawName || rawName.length > 60) return null;
  const pitch = html.split(/<p>/i).slice(1).map(stripTags).find((p) => p.length > 30 && !/^https?:/i.test(p)) ?? null;
  return { name: rawName, domain, pitch: clip(pitch ? pitch.split(/(?<=\.)\s/)[0] : null, 250) };
}

const HN = 'https://hn.algolia.com/api/v1';
const HN_QUERIES = ['voice', 'speech', 'tts', 'text to speech', 'asr', 'voice agent'];

export async function loadHnHiring(http: RaHttp, months = 3): Promise<{ found: { name: string; domain: string; pitch: string | null; fact: NonNullable<JobsFact['hn']> }[]; errors: string[]; scanned: number }> {
  const out: { name: string; domain: string; pitch: string | null; fact: NonNullable<JobsFact['hn']> }[] = [];
  const errors: string[] = [];
  let scanned = 0;
  const threads = await http.get(`${HN}/search_by_date?tags=story,author_whoishiring&hitsPerPage=20`, { minDelayMs: 1000 });
  const stories = (parseJson<{ hits?: HnHit[] }>(threads.text)?.hits ?? []).filter((h) => /who is hiring/i.test(h.title ?? '')).slice(0, months);
  if (!threads.ok) errors.push(`HN threads: ${threads.blocked ?? `HTTP ${threads.status}`}`);
  const seen = new Set<string>();
  for (const s of stories) {
    for (const q of HN_QUERIES) {
      const r = await http.get(`${HN}/search?query=${encodeURIComponent(q)}&tags=comment,story_${s.objectID}&hitsPerPage=200`, { minDelayMs: 1000 });
      if (!r.ok) { errors.push(`HN ${s.objectID} "${q}": ${r.blocked ?? `HTTP ${r.status}`}`); continue; }
      for (const hit of parseJson<{ hits?: HnHit[] }>(r.text)?.hits ?? []) {
        scanned++;
        if (seen.has(hit.objectID)) continue;
        seen.add(hit.objectID);
        if (!VOICE_ROLE.test(stripTags(hit.comment_text ?? ''))) continue;
        const p = parseHiringComment(hit);
        if (p) out.push({ ...p, fact: { item: hit.objectID, thread: (s.title ?? '').replace(/^Ask HN:\s*/i, '') } });
      }
    }
  }
  return { found: out, errors, scanned };
}

// ---- the source -------------------------------------------------------------

export async function probeAts(http: RaHttp, company: Company): Promise<JobsFact['ats'] | null> {
  const tries: { ats: Ats; slug: string; known: boolean }[] = company.ats
    ? [{ ...company.ats, known: true }]
    : atsSlugs(company.name, company.domain).flatMap((slug) => (['greenhouse', 'lever', 'ashby'] as Ats[]).map((ats) => ({ ats, slug, known: false })));
  for (let i = 0; i < tries.length; i += 3) {
    const batch = tries.slice(i, i + 3);
    const results = await Promise.all(batch.map(async (t) => ({ t, r: await http.get(atsUrl(t.ats, t.slug), { minDelayMs: 1000 }) })));
    for (const { t, r } of results) {
      if (!r.ok) continue;
      const jobs = parseAtsJobs(t.ats, r.text);
      if (!jobs || !jobs.length) continue;
      if (!t.known && !boardBelongsTo(jobs, company)) continue;
      const voice = matchVoiceRoles(jobs);
      return { ats: t.ats, slug: t.slug, openRoles: jobs.length, voiceRoles: voice.length, titles: voice.map((j) => j.title).slice(0, 8) };
    }
  }
  return null;
}

export async function loadJobsSignal(
  http: RaHttp, companies: Company[], opts: { log?: (m: string) => void; hnMonths?: number; maxCompanies?: number } = {},
): Promise<RaLoadResult> {
  const res = emptyResult();
  const byDomain = new Map<string, { company: Company & { description?: string | null }; fact: JobsFact }>();
  const list = dedupeCompanies([...SEED_COMPANIES, ...companies]).slice(0, opts.maxCompanies ?? 400);
  res.notes.push(`probing ATS boards for ${list.length} companies`);
  for (const c of list) {
    res.scanned++;
    if (res.scanned % 25 === 0) opts.log?.(`ATS probes ${res.scanned}/${list.length}, ${byDomain.size} hiring for voice/speech`);
    const ats = await probeAts(http, c);
    if (!ats) { reject(res, 'no public ATS board found'); continue; }
    if (!ats.voiceRoles) { reject(res, 'ATS board has no voice/speech roles'); continue; }
    opts.log?.(`${c.domain}: ${ats.voiceRoles} voice role(s) on ${ats.ats}/${ats.slug}`);
    byDomain.set(c.domain, { company: c, fact: { ats } });
  }
  if ((opts.hnMonths ?? 3) > 0) {
    const hn = await loadHnHiring(http, opts.hnMonths ?? 3);
    res.errors.push(...hn.errors);
    res.notes.push(`HN who-is-hiring: ${hn.found.length} voice/speech company posts in ${hn.scanned} hits`);
    for (const h of hn.found) {
      const cur = byDomain.get(h.domain);
      if (cur) { cur.fact.hn ??= h.fact; cur.company.description ??= h.pitch; continue; }
      byDomain.set(h.domain, { company: { name: h.name || nameFromDomain(h.domain), domain: h.domain, description: h.pitch }, fact: { hn: h.fact } });
    }
  }
  for (const { company, fact } of byDomain.values()) res.leads.push(toJobsLead(company, fact));
  return res;
}

export function dedupeCompanies(list: Company[]): Company[] {
  const seen = new Set<string>();
  const out: Company[] = [];
  for (const c of list) {
    const d = c.domain.toLowerCase();
    if (seen.has(d) || isVendorHost(d)) continue;
    seen.add(d);
    out.push(c);
  }
  return out;
}
