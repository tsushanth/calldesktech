// ra-github-orgs: GitHub ORGANISATIONS (never user accounts) with a public
// speech/voice signal, via the official REST API:
//   (a) code search: org-owned code calling a competing speech API
//       (api.elevenlabs.io / api.cartesia.ai / api.deepgram.com)
//   (b) org search by location for voice/speech/TTS/ASR orgs
//   (c) repositories tagged text-to-speech / speech-recognition / voice-agent,
//       pushed this year, >5 stars, org-owned
// then GET /orgs/<login> for what the org itself publishes: name, blog
// (website), public email, location, description. Nothing about individual
// users is requested or stored (GitHub's terms bar using personal data from
// the site for marketing).
//
// Auth: GITHUB_TOKEN, else `gh auth token`. Unauthenticated, code search is
// unavailable (GitHub requires auth for it) and is skipped with a message; the
// other two still run at the lower unauthenticated search limit.
// Rate limits: code search 10 req/min (spaced 7s), other search 30/min
// authenticated (spaced 2.5s), core API spaced 250ms; a rate-limit 403/429
// waits for the reset once (up to 70s) and otherwise ends that query softly.

import { execFileSync } from 'node:child_process';
import { clip, companyRoleEmail, emptyResult, isFreeMail, isPersonalSite, isVendorHost, orgDomain, parseJson, reject, sleep, type RaHttp, type RaLead, type RaLoadResult } from './common';

const API = 'https://api.github.com';

export const CODE_QUERIES: { q: string; api: string }[] = [
  { q: '"api.elevenlabs.io" language:TypeScript', api: 'ElevenLabs' },
  { q: '"api.elevenlabs.io" language:Python', api: 'ElevenLabs' },
  { q: '"api.cartesia.ai"', api: 'Cartesia' },
  { q: '"api.deepgram.com"', api: 'Deepgram' },
  { q: 'ELEVENLABS_API_KEY filename:package.json', api: 'ElevenLabs' },
];
export const ORG_LOCATIONS = ['India', 'Indonesia', 'Korea', 'Brazil', 'Poland', 'Nigeria', 'Egypt', 'Japan'];
export const REPO_TOPICS = ['text-to-speech', 'speech-recognition', 'voice-agent'];

export function resolveGithubToken(env: NodeJS.ProcessEnv = process.env): { token: string | null; via: string } {
  if (env.GITHUB_TOKEN?.trim()) return { token: env.GITHUB_TOKEN.trim(), via: 'GITHUB_TOKEN' };
  try {
    const t = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
    if (t) return { token: t, via: 'gh auth token' };
  } catch { /* gh missing or logged out */ }
  return { token: null, via: 'none' };
}

interface Owner { login?: string; type?: string }
export interface GithubOrg {
  login?: string; name?: string | null; blog?: string | null; email?: string | null; location?: string | null;
  description?: string | null; public_repos?: number | null; html_url?: string | null; type?: string | null; is_verified?: boolean | null;
}

// Owners of type Organization from a code-search page (items[].repository.owner).
export function orgOwnersFromCodeSearch(json: { items?: { repository?: { full_name?: string; owner?: Owner } }[] } | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const it of json?.items ?? []) {
    const o = it.repository?.owner;
    if (!o?.login || o.type !== 'Organization') continue;
    const k = o.login.toLowerCase();
    const repos = out.get(k) ?? [];
    if (it.repository?.full_name && !repos.includes(it.repository.full_name)) repos.push(it.repository.full_name);
    out.set(k, repos);
  }
  return out;
}

// search/users?q=type:org ...: items are already orgs; keep type check anyway.
export function orgLoginsFromUserSearch(json: { items?: Owner[] } | null): string[] {
  return (json?.items ?? []).filter((i) => i.type === 'Organization' && i.login).map((i) => (i.login as string).toLowerCase());
}

// search/repositories: org-owned repos with their stars.
export function orgReposFromRepoSearch(json: { items?: { full_name?: string; stargazers_count?: number; owner?: Owner }[] } | null): { login: string; repo: string; stars: number }[] {
  return (json?.items ?? [])
    .filter((r) => r.owner?.type === 'Organization' && r.owner.login)
    .map((r) => ({ login: (r.owner?.login as string).toLowerCase(), repo: r.full_name ?? '', stars: r.stargazers_count ?? 0 }));
}

export interface OrgEvidence { apis: Set<string>; repos: Set<string>; maxStars: number; viaLocation: string | null; topics: Set<string> }

export function newEvidence(): OrgEvidence {
  return { apis: new Set(), repos: new Set(), maxStars: 0, viaLocation: null, topics: new Set() };
}

// One org -> lead (or a reject reason). Pure.
export function toGithubLead(org: GithubOrg, ev: OrgEvidence): RaLead | { reject: string } {
  if (!org.login) return { reject: 'no login' };
  if (org.type && org.type !== 'Organization') return { reject: 'not an organisation' };
  let domain = orgDomain(org.blog);
  const email = org.email && !isFreeMail(org.email) ? org.email.toLowerCase() : null;
  if (!domain && email) domain = orgDomain(email.split('@')[1]);
  if (!domain) return { reject: 'no organisation website' };
  if (isVendorHost(domain)) return { reject: 'speech-API vendor itself' };
  const name = clip(org.name || org.login, 120) as string;
  if (isPersonalSite(name, domain)) return { reject: 'personal site' };

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, r: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${r}`); };
  if (ev.apis.size) add(20, `org's public code calls a competing speech API (${[...ev.apis].join(', ')})`);
  if (ev.topics.size) add(5, `org maintains ${[...ev.topics].join('/')} repositories`);
  if (ev.maxStars >= 100) add(5, `speech repo with ${ev.maxStars} stars`);
  if (ev.viaLocation && !ev.apis.size && !ev.topics.size) add(3, `voice/speech org on GitHub (${ev.viaLocation})`);
  if ((org.public_repos ?? 0) <= 2) add(-10, 'very small GitHub org (hobbyist signal)');

  const roleEmail = companyRoleEmail(org.email, domain);
  return {
    sourceId: 'ra-github-orgs',
    sourceKey: `readaloud:github:${org.login.toLowerCase()}`,
    name,
    domain,
    location: clip(org.location, 200),
    description: clip(org.description, 300),
    signalSource: ev.apis.size ? 'tech_fingerprint' : 'search',
    signalDetail: clip(`GitHub org ${org.login}: ${ev.apis.size ? `code calls ${[...ev.apis].join('/')}` : ev.topics.size ? `topics ${[...ev.topics].join('/')}` : `voice/speech org (${ev.viaLocation ?? 'search'})`}`, 280) as string,
    email: roleEmail,
    emailSourceUrl: roleEmail ? `https://github.com/${org.login}` : null,
    source: {
      adjust,
      reasons,
      facts: {
        githubOrg: org.login, apis: [...ev.apis], topics: [...ev.topics], repos: [...ev.repos].slice(0, 5),
        maxStars: ev.maxStars, publicRepos: org.public_repos ?? null, via: ev.apis.size ? 'code-search' : ev.topics.size ? 'repo-topics' : 'org-search',
      },
    },
  };
}

class Gh {
  constructor(private http: RaHttp, private token: string | null, private log: (m: string) => void) {}
  async get<T>(path: string, spacingMs: number): Promise<{ data: T | null; error: string | null }> {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.http.get(`${API}${path}`, { headers, minDelayMs: spacingMs });
      if (r.ok) return { data: parseJson<T>(r.text), error: null };
      const limited = (r.status === 403 || r.status === 429) && (r.headers['x-ratelimit-remaining'] === '0' || /rate limit/i.test(r.text));
      if (limited && attempt === 0) {
        const reset = Number(r.headers['x-ratelimit-reset']);
        const retryAfter = Number(r.headers['retry-after']);
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Number.isFinite(reset) ? reset * 1000 - Date.now() + 1000 : 60_000;
        if (waitMs <= 70_000) { this.log(`GitHub rate limit; waiting ${Math.ceil(waitMs / 1000)}s`); await sleep(Math.max(1000, waitMs)); continue; }
        return { data: null, error: `rate limited until ${new Date(reset * 1000).toISOString()}` };
      }
      return { data: null, error: r.blocked ?? `HTTP ${r.status}${r.text ? `: ${r.text.slice(0, 120)}` : ''}` };
    }
    return { data: null, error: 'rate limited' };
  }
}

export async function loadGithubOrgs(
  http: RaHttp,
  opts: { log?: (m: string) => void; token?: string | null; codePages?: number; searchPages?: number; maxOrgs?: number; year?: number; parts?: ('code' | 'orgs' | 'topics')[] } = {},
): Promise<RaLoadResult> {
  const res = emptyResult();
  const log = opts.log ?? (() => {});
  const token = opts.token !== undefined ? opts.token : resolveGithubToken().token;
  const gh = new Gh(http, token, log);
  const parts = opts.parts ?? ['code', 'orgs', 'topics'];
  const codePages = opts.codePages ?? 3;
  const searchPages = opts.searchPages ?? 2;
  const searchSpacing = token ? 2500 : 6500;
  const evidence = new Map<string, OrgEvidence>();
  const ev = (login: string) => { let e = evidence.get(login); if (!e) { e = newEvidence(); evidence.set(login, e); } return e; };

  if (!token) res.notes.push('GitHub unauthenticated (set GITHUB_TOKEN or `gh auth login`): code search skipped, other searches run at the 10/min anonymous limit');

  if (parts.includes('code') && token) {
    outer: for (const { q, api } of CODE_QUERIES) {
      for (let page = 1; page <= codePages; page++) {
        const { data, error } = await gh.get<{ total_count?: number; items?: [] }>(`/search/code?q=${encodeURIComponent(q)}&per_page=100&page=${page}`, 7000);
        if (error) { res.errors.push(`code search ${q} p${page}: ${error}`); if (/rate limited until/.test(error)) break outer; break; }
        res.scanned += data?.items?.length ?? 0;
        log(`code search ${q} p${page}: ${data?.items?.length ?? 0} files (total ${data?.total_count ?? '?'})`);
        for (const [login, repos] of orgOwnersFromCodeSearch(data)) { const e = ev(login); e.apis.add(api); repos.forEach((r) => e.repos.add(r)); }
        if ((data?.items?.length ?? 0) < 100) break;
      }
    }
  }

  if (parts.includes('orgs')) {
    for (const loc of ORG_LOCATIONS) {
      for (let page = 1; page <= searchPages; page++) {
        const q = `type:org location:${loc} tts OR asr OR speech OR voice`;
        const { data, error } = await gh.get<{ items?: Owner[] }>(`/search/users?q=${encodeURIComponent(q)}&per_page=100&page=${page}`, searchSpacing);
        if (error) { res.errors.push(`org search ${loc}: ${error}`); break; }
        const logins = orgLoginsFromUserSearch(data);
        res.scanned += logins.length;
        log(`org search ${loc} p${page}: ${logins.length} orgs`);
        for (const login of logins) { const e = ev(login); e.viaLocation ??= loc; }
        if ((data?.items?.length ?? 0) < 100) break;
      }
    }
  }

  if (parts.includes('topics')) {
    const year = opts.year ?? new Date().getUTCFullYear();
    for (const topic of REPO_TOPICS) {
      for (let page = 1; page <= searchPages; page++) {
        const q = `topic:${topic} pushed:>=${year}-01-01 stars:>5`;
        const { data, error } = await gh.get<{ items?: [] }>(`/search/repositories?q=${encodeURIComponent(q)}&per_page=100&page=${page}`, searchSpacing);
        if (error) { res.errors.push(`repo search ${topic}: ${error}`); break; }
        res.scanned += data?.items?.length ?? 0;
        log(`repo search ${topic} p${page}: ${data?.items?.length ?? 0} repos`);
        for (const r of orgReposFromRepoSearch(data)) { const e = ev(r.login); e.topics.add(topic); e.repos.add(r.repo); e.maxStars = Math.max(e.maxStars, r.stars); }
        if ((data?.items?.length ?? 0) < 100) break;
      }
    }
  }

  // Strongest evidence first, so a cap keeps the best orgs.
  const rank = (e: OrgEvidence) => (e.apis.size ? 100 : 0) + (e.topics.size ? 10 : 0) + Math.min(9, Math.log10(1 + e.maxStars) * 3);
  const logins = [...evidence.entries()].sort((a, b) => rank(b[1]) - rank(a[1])).map(([l]) => l).slice(0, opts.maxOrgs ?? 400);
  res.notes.push(`${evidence.size} candidate orgs (${[...evidence.values()].filter((e) => e.apis.size).length} via code search); looking up ${logins.length}`);
  for (const [n, login] of logins.entries()) {
    if (n && n % 50 === 0) log(`org lookups ${n}/${logins.length}, ${res.leads.length} leads so far`);
    const { data, error } = await gh.get<GithubOrg>(`/orgs/${encodeURIComponent(login)}`, token ? 250 : 6500);
    if (error || !data) { reject(res, 'org lookup failed'); if (error && /rate limited until/.test(error)) { res.errors.push(`org lookup: ${error}`); break; } continue; }
    const lead = toGithubLead(data, evidence.get(login) as OrgEvidence);
    if ('reject' in lead) { reject(res, lead.reject); continue; }
    res.leads.push(lead);
  }
  return res;
}
