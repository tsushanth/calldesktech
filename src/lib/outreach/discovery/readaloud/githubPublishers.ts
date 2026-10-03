// ra-github-publishers: GitHub ORGANISATIONS (never user accounts) that publish
// WordPress plugins or CMS / read-aloud tools with text-to-speech, "listen to
// this article", "audio version" or narration features (publishers, newsletters,
// accessibility and e-learning tooling). Official REST API only:
//   (a) repository search: topic:wordpress-plugin plus those keywords, and the
//       read-aloud / article-to-audio topics; org-owned repositories only
//   (b) GET /orgs/<login> for what the org itself publishes: name, blog
//       (website), PUBLIC org email, location, description.
//
// HARD RULES
//   * Organisations only. User-owned repositories are dropped at the parser.
//   * The only address ever used is a role mailbox (info@, support@, ...) that
//     the organisation itself publishes on its org profile, at its own domain.
//     Never commit-author emails, never member emails, never anything about
//     individual users (GitHub's terms bar using that data for marketing).
//     Website contact discovery for the rest is the daily run's stageEnrich.
//   * Personal sites / github.io / generic hosts are rejected by the shared
//     helpers (orgDomain, isPersonalSite).
//
// Auth, spacing and soft failure follow githubOrgs.ts: GITHUB_TOKEN, else
// `gh auth token`; search spaced 2.5s authenticated / 6.5s anonymous, org
// lookups 250ms / 6.5s; a rate-limit 403/429 waits once (<=70s) and otherwise
// ends that query softly.

import { clip, companyRoleEmail, emptyResult, isFreeMail, isPersonalSite, isVendorHost, orgDomain, reject, type RaHttp, type RaLead, type RaLoadResult } from './common';
import { Gh, orgReposFromRepoSearch, resolveGithubToken, type GithubOrg } from './githubOrgs';

// { q: search text (year appended by the loader), label: what the facts record }
export const PUBLISHER_QUERIES: { q: string; label: string }[] = [
  { q: 'topic:wordpress-plugin text-to-speech', label: 'wordpress text-to-speech' },
  { q: 'topic:wordpress-plugin "listen to this article"', label: 'wordpress listen-to-article' },
  { q: 'topic:wordpress-plugin "audio version"', label: 'wordpress audio-version' },
  { q: 'topic:wordpress-plugin narration', label: 'wordpress narration' },
  { q: 'topic:wordpress-plugin "read aloud"', label: 'wordpress read-aloud' },
  { q: 'topic:read-aloud', label: 'read-aloud topic' },
  { q: 'topic:article-to-audio', label: 'article-to-audio topic' },
  { q: 'topic:text-to-speech topic:cms', label: 'cms text-to-speech' },
  { q: '"listen to this article" in:description,readme', label: 'listen-to-article' },
];

export interface PublisherEvidence { labels: Set<string>; repos: Set<string>; maxStars: number }
export function newPublisherEvidence(): PublisherEvidence { return { labels: new Set(), repos: new Set(), maxStars: 0 }; }

// One org -> lead (or a reject reason). Pure.
export function toPublisherLead(org: GithubOrg, ev: PublisherEvidence): RaLead | { reject: string } {
  if (!org.login) return { reject: 'no login' };
  if (org.type && org.type !== 'Organization') return { reject: 'not an organisation' };
  let domain = orgDomain(org.blog);
  const rawEmail = org.email && !isFreeMail(org.email) ? org.email.toLowerCase() : null;
  if (!domain && rawEmail) domain = orgDomain(rawEmail.split('@')[1]);
  if (!domain) return { reject: 'no organisation website' };
  if (isVendorHost(domain)) return { reject: 'speech-API vendor itself' };
  const name = clip(org.name || org.login, 120) as string;
  if (isPersonalSite(name, domain)) return { reject: 'personal site' };

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, r: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${r}`); };
  add(8, 'publishes a CMS / WordPress tool with text-to-speech or audio-version features');
  if (ev.maxStars >= 100) add(4, `audio plugin repository with ${ev.maxStars} stars`);
  if ((org.public_repos ?? 0) <= 2) add(-10, 'very small GitHub org (hobbyist signal)');

  // Only the org's OWN published role mailbox at its own domain.
  const roleEmail = companyRoleEmail(org.email, domain);
  return {
    sourceId: 'ra-github-publishers',
    sourceKey: `readaloud:github-publisher:${org.login.toLowerCase()}`,
    name,
    domain,
    location: clip(org.location, 200),
    description: clip(org.description, 300),
    signalSource: 'search',
    signalDetail: clip(`GitHub org ${org.login}: ${[...ev.labels].slice(0, 3).join(', ')}`, 280) as string,
    email: roleEmail,
    emailSourceUrl: roleEmail ? `https://github.com/${org.login}` : null,
    source: {
      adjust,
      reasons,
      facts: { githubOrg: org.login, matched: [...ev.labels], repos: [...ev.repos].slice(0, 5), maxStars: ev.maxStars, publicRepos: org.public_repos ?? null },
    },
  };
}

export async function loadGithubPublishers(
  http: RaHttp,
  opts: { log?: (m: string) => void; token?: string | null; searchPages?: number; maxOrgs?: number; year?: number } = {},
): Promise<RaLoadResult> {
  const res = emptyResult();
  const log = opts.log ?? (() => {});
  const token = opts.token !== undefined ? opts.token : resolveGithubToken().token;
  const gh = new Gh(http, token, log);
  const searchPages = opts.searchPages ?? 2;
  const searchSpacing = token ? 2500 : 6500;
  const since = (opts.year ?? new Date().getUTCFullYear()) - 1;
  const evidence = new Map<string, PublisherEvidence>();
  if (!token) res.notes.push('GitHub unauthenticated (set GITHUB_TOKEN or `gh auth login`): searches run at the 10/min anonymous limit');

  for (const { q, label } of PUBLISHER_QUERIES) {
    for (let page = 1; page <= searchPages; page++) {
      const { data, error } = await gh.get<{ items?: [] }>(`/search/repositories?q=${encodeURIComponent(`${q} pushed:>=${since}-01-01`)}&per_page=100&page=${page}`, searchSpacing);
      if (error) { res.errors.push(`repo search "${label}": ${error}`); break; }
      res.scanned += data?.items?.length ?? 0;
      log(`repo search "${label}" p${page}: ${data?.items?.length ?? 0} repos`);
      for (const r of orgReposFromRepoSearch(data)) {
        let e = evidence.get(r.login);
        if (!e) { e = newPublisherEvidence(); evidence.set(r.login, e); }
        e.labels.add(label); e.repos.add(r.repo); e.maxStars = Math.max(e.maxStars, r.stars);
      }
      if ((data?.items?.length ?? 0) < 100) break;
    }
  }

  // Most-matched / most-starred first, so a cap keeps the best orgs.
  const rank = (e: PublisherEvidence) => e.labels.size * 10 + Math.min(9, Math.log10(1 + e.maxStars) * 3);
  const logins = [...evidence.entries()].sort((a, b) => rank(b[1]) - rank(a[1])).map(([l]) => l).slice(0, opts.maxOrgs ?? 300);
  res.notes.push(`${evidence.size} candidate orgs; looking up ${logins.length}`);
  for (const [n, login] of logins.entries()) {
    if (n && n % 50 === 0) log(`org lookups ${n}/${logins.length}, ${res.leads.length} leads so far`);
    const { data, error } = await gh.get<GithubOrg>(`/orgs/${encodeURIComponent(login)}`, token ? 250 : 6500);
    if (error || !data) { reject(res, 'org lookup failed'); if (error && /rate limited until/.test(error)) { res.errors.push(`org lookup: ${error}`); break; } continue; }
    const lead = toPublisherLead(data, evidence.get(login) as PublisherEvidence);
    if ('reject' in lead) { reject(res, lead.reject); continue; }
    res.leads.push(lead);
  }
  return res;
}
