import { CALLDESK_CERTIFICATION_ALLOW_LIST, CALLDESK_SUPPORT_EMAIL, FEATURE_VOCABULARY } from '@/content/calldeskFacts';
import type { Library } from './load';
import type { Competitor } from './schema';
import type { LibraryPageModel, PageType } from './model';
import { buildPages, hubModels, migrationCompetitors } from './pages';
import { isPublished, publishKey } from './publish';
import { BANNED_LITE, BANNED_STRICT, findBanned } from './banned';
import { findCertClaims, type CertKey } from './certs';
import { SIMILARITY, similarityReport } from './similarity';
import { textOfPage, wordCount } from './text';
import { MIGRATE_CAP } from './routes';

// The quality gate. validateLibrary() returns every problem it finds; test/lib/seoLibrary/realContent.test.ts fails on any
// 'error', and src/lib/seoLibrary/index.ts refuses to build when a PUBLISHED page has one. Rules (all numbers live in LIMITS or
// SIMILARITY so they are documented in one place):
//
//  data      every competitor fact has a sourceUrl that is listed in sources[] (which carries its retrievedAt); dates are real and not
//            in the future; migration steps have sources; filename = slug
//  pages     title, description, h1, path present; no two pages share a title, a description or a path; minimum word count per type
//  wording   no superlative, disparaging or unverifiable word on competitor pages (banned.ts); lighter list on industry/use-case pages
//  certs     no certification statement for Calldesk (allow-list in calldeskFacts.ts, empty) or for a competitor ('stated' in its data)
//  similar   pages of one type: pairwise 5-word-shingle Jaccard <= SIMILARITY.maxPairJaccard, unique share >= SIMILARITY.minUniqueShare
//  seo       competitor pages carry last-verified, sources, the corrections address, and never FAQ markup
//  links     related slugs resolve; publish.json entries match real pages

export type Severity = 'error' | 'warning';
export type Issue = { severity: Severity; code: string; where: string; message: string; key?: string };

export const LIMITS = {
  minWords: { compare: 450, alternatives: 400, migrate: 350, industry: 600, 'use-case': 550 } as Record<PageType, number>,
  introMinWords: 150,
  titleMax: 70,
  descriptionMin: 70,
  descriptionMax: 165,
  staleAfterDays: 90,
  minDialogueTurns: 4,
};

const COMPETITOR_TYPES: PageType[] = ['compare', 'alternatives', 'migrate'];
const isCompetitorType = (t: PageType) => COMPETITOR_TYPES.includes(t);

const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

export function validateCompetitor(c: Competitor, now: Date = new Date()): Issue[] {
  const issues: Issue[] = [];
  const w = `competitors/${c.slug}`;
  const err = (code: string, message: string) => issues.push({ severity: 'error', code, where: w, message });
  const warn = (code: string, message: string) => issues.push({ severity: 'warning', code, where: w, message });
  const today = now.toISOString().slice(0, 10);
  const listed = new Map(c.sources.map((s) => [norm(s.url), s]));

  if (c.retrievedAt > today) err('DATE_FUTURE', `retrievedAt ${c.retrievedAt} is in the future`);
  for (const s of c.sources) if (s.retrievedAt > today) err('DATE_FUTURE', `source ${s.url} retrievedAt ${s.retrievedAt} is in the future`);
  const ageDays = Math.floor((now.getTime() - Date.parse(`${c.retrievedAt}T00:00:00Z`)) / 86_400_000);
  if (ageDays > LIMITS.staleAfterDays) warn('STALE', `retrievedAt is ${ageDays} days old (limit ${LIMITS.staleAfterDays}); re-verify before publishing`);

  const needSource = (what: string, url: string | undefined) => {
    if (!url) return err('FACT_NO_SOURCE', `${what} has no sourceUrl`);
    if (!listed.has(norm(url))) err('FACT_SOURCE_NOT_LISTED', `${what} cites ${url}, which is not in sources[] (sources[] carries the retrievedAt)`);
  };
  if (c.pricing.sourceUrls.length === 0) err('FACT_NO_SOURCE', 'pricing has no sourceUrls');
  c.pricing.sourceUrls.forEach((u) => needSource('pricing', u));
  // When hipaa, soc2 and gdpr are all 'not-stated' there is no compliance fact to cite. Any 'stated' value still needs a listed source.
  const complianceStatesSomething = [c.compliance.hipaa, c.compliance.soc2, c.compliance.gdpr].some((v) => v !== 'not-stated');
  if (complianceStatesSomething || c.compliance.sourceUrl) needSource('compliance', c.compliance.sourceUrl);
  needSource('telephony', c.telephony.sourceUrl);
  if (c.migration.stepsToLeave.length && c.migration.sourceUrls.length === 0) err('FACT_NO_SOURCE', 'migration.stepsToLeave has no sourceUrls');
  c.migration.sourceUrls.forEach((u) => needSource('migration', u));
  c.strengths.forEach((s, i) => needSource(`strengths[${i}]`, s.sourceUrl));
  c.limitations.forEach((s, i) => needSource(`limitations[${i}]`, s.sourceUrl));
  for (const s of c.sources) if (!/^https:/i.test(s.url)) warn('SOURCE_NOT_HTTPS', `${s.url} is not https`);
  if (c.status === 'active' && c.strengths.length < 2) warn('THIN_DATA', 'fewer than 2 strengths; the pages for this competitor will be short');
  if (c.status === 'active' && c.unknowns.length === 0) warn('NO_UNKNOWNS', 'unknowns[] is empty; confirm nothing was left unverified');
  return issues;
}

function validateContentData(lib: Library, checkRelated: boolean): Issue[] {
  const issues: Issue[] = [];
  const all = new Set([...lib.industries.map((i) => i.slug), ...lib.useCases.map((u) => u.slug)]);
  const check = (kind: 'industries' | 'use-cases', d: { slug: string; intro: string; metaDescription: string; sampleCallFlow: { speaker: string }[]; relatedSlugs: string[]; featuresUsed: { feature: string }[] }) => {
    const where = `${kind}/${d.slug}`;
    const e = (code: string, message: string) => issues.push({ severity: 'error', code, where, message, key: publishKey(kind === 'industries' ? 'industry' : 'use-case', d.slug) });
    const wn = (code: string, message: string) => issues.push({ severity: 'warning', code, where, message });
    if (wordCount(d.intro) < LIMITS.introMinWords) e('INTRO_SHORT', `intro has ${wordCount(d.intro)} words, needs at least ${LIMITS.introMinWords}`);
    if (d.sampleCallFlow.length < LIMITS.minDialogueTurns) e('DIALOGUE_SHORT', `sampleCallFlow has ${d.sampleCallFlow.length} turns, needs at least ${LIMITS.minDialogueTurns}`);
    if (!d.sampleCallFlow.some((t) => t.speaker === 'caller') || !d.sampleCallFlow.some((t) => t.speaker === 'agent')) e('DIALOGUE_SPEAKERS', 'sampleCallFlow needs both a caller and an agent turn');
    if (new Set(d.relatedSlugs).size !== d.relatedSlugs.length) wn('RELATED_DUPLICATE', 'relatedSlugs lists the same slug more than once');
    for (const r of d.relatedSlugs) {
      if (!checkRelated) break;
      if (r === d.slug) e('RELATED_SELF', `relatedSlugs contains its own slug "${r}"`);
      else if (!all.has(r)) e('RELATED_MISSING', `relatedSlugs "${r}" matches no industry or use case`);
    }
    if (d.metaDescription.length > LIMITS.descriptionMax) wn('DESC_LONG', `metaDescription is ${d.metaDescription.length} characters (limit ${LIMITS.descriptionMax})`);
    if (d.metaDescription.length < LIMITS.descriptionMin) wn('DESC_SHORT', `metaDescription is ${d.metaDescription.length} characters (minimum ${LIMITS.descriptionMin})`);
    const vocab = FEATURE_VOCABULARY.map((f) => f.name.toLowerCase());
    for (const f of d.featuresUsed) {
      const n = f.feature.toLowerCase();
      if (!vocab.some((v) => n.includes(v) || v.includes(n))) wn('FEATURE_NOT_IN_FACTS', `feature "${f.feature}" is not in FEATURE_VOCABULARY (src/content/calldeskFacts.ts); confirm the product has it`);
    }
  };
  lib.industries.forEach((d) => check('industries', d));
  lib.useCases.forEach((d) => check('use-cases', d));
  return issues;
}

/** Every check that looks at one page on its own. Exported for tests. */
export function validatePage(lib: Library, p: LibraryPageModel): Issue[] {
  const issues: Issue[] = [];
  const e = (code: string, message: string) => issues.push({ severity: 'error', code, where: p.path, message, key: p.key });
  const wn = (code: string, message: string) => issues.push({ severity: 'warning', code, where: p.path, message, key: p.key });
  for (const f of ['title', 'description', 'h1', 'lede', 'path'] as const) if (!p[f] || !p[f].trim()) e('MISSING_FIELD', `${f} is empty`);
  if (p.blocks.length === 0) e('MISSING_FIELD', 'page has no body');
  if (p.title.length > LIMITS.titleMax) wn('TITLE_LONG', `title is ${p.title.length} characters (limit ${LIMITS.titleMax})`);
  if (p.description.length > LIMITS.descriptionMax) wn('DESC_LONG', `description is ${p.description.length} characters (limit ${LIMITS.descriptionMax})`);

  const body = textOfPage(p, { skip: ['sources'] });
  const words = wordCount(body);
  if (words < LIMITS.minWords[p.type]) e('THIN_PAGE', `${words} words; ${p.type} pages need at least ${LIMITS.minWords[p.type]} (thin pages risk being treated as spam)`);

  const strict = isCompetitorType(p.type);
  const allowNames = [p.competitorName ?? ''];
  for (const h of findBanned(`${p.title}\n${p.description}\n${body}`, strict ? BANNED_STRICT : BANNED_LITE, allowNames)) e('BANNED_WORD', `"${h.term}" in: ...${h.context}...`);

  const comp = p.competitorSlug ? lib.competitors.find((c) => c.slug === p.competitorSlug) : undefined;
  for (const claim of findCertClaims(`${p.title}\n${p.description}\n${body}`)) {
    if (strict && !claim.calldeskSubject && comp) {
      const k = claim.cert as CertKey;
      const stated = k === 'hipaa' || k === 'soc2' || k === 'gdpr' ? comp.compliance[k] === 'stated' : new RegExp(k === 'iso27001' ? 'ISO' : k, 'i').test(comp.compliance.note);
      if (!stated) e('CERT_CLAIM_COMPETITOR', `${comp.name} is described with ${claim.cert.toUpperCase()} but its data does not say 'stated': "${claim.sentence}"`);
    } else if (!CALLDESK_CERTIFICATION_ALLOW_LIST.includes(claim.cert)) {
      e('CERT_CLAIM', `certification wording not allowed (${claim.cert.toUpperCase()}; the Calldesk allow-list is [${CALLDESK_CERTIFICATION_ALLOW_LIST.join(', ')}]): "${claim.sentence}"`);
    }
  }

  if (strict) {
    if (!p.lastVerified) e('NO_VERIFIED_DATE', 'competitor page has no last-verified date');
    if (!body.includes(CALLDESK_SUPPORT_EMAIL)) e('NO_CORRECTIONS', `page does not carry the corrections address ${CALLDESK_SUPPORT_EMAIL}`);
    if (!/may have changed them since/i.test(body)) e('NO_DISCLAIMER', 'page does not carry the public-pages disclaimer');
    if (!p.blocks.some((b) => b.kind === 'sources' && b.items.length > 0)) e('NO_SOURCES', 'competitor page lists no sources');
    if (p.faqJsonLd || p.blocks.some((b) => b.kind === 'faq')) e('FAQ_ON_COMPETITOR_PAGE', 'competitor pages must not carry FAQ markup');
  }
  for (const b of p.blocks) {
    if (b.kind === 'table') for (const r of b.rows) for (const c of r) if (!c.text.trim()) e('EMPTY_CELL', `table row "${r[0]?.text}" has an empty cell (omit rows where either side is unknown)`);
  }
  return issues;
}

export type ValidationResult = {
  issues: Issue[];
  errors: Issue[];
  warnings: Issue[];
  pages: LibraryPageModel[];
  similarity: Record<string, ReturnType<typeof similarityReport>>;
};

/**
 * `checkRelated: false` skips the check that relatedSlugs name real pages. Only the test fixtures (3 content pages in all) use it,
 * because four related slugs cannot all resolve in a library that small.
 */
export function validateLibrary(lib: Library, now: Date = new Date(), opts: { checkRelated?: boolean } = {}): ValidationResult {
  const issues: Issue[] = [];
  const pages = buildPages(lib);

  for (const c of lib.competitors) issues.push(...validateCompetitor(c, now));
  issues.push(...validateContentData(lib, opts.checkRelated !== false));
  for (const p of pages) issues.push(...validatePage(lib, p));

  // uniqueness across every page and hub
  const hubs = Object.values(hubModels());
  const seen = { title: new Map<string, string>(), description: new Map<string, string>(), path: new Map<string, string>() };
  for (const p of [...pages, ...hubs]) {
    const id = p.path;
    for (const f of ['title', 'description', 'path'] as const) {
      const v = p[f].trim().toLowerCase();
      const prev = seen[f].get(v);
      if (prev) issues.push({ severity: 'error', code: `DUPLICATE_${f.toUpperCase()}`, where: id, message: `${f} duplicates ${prev}: "${p[f]}"`, key: 'key' in p ? p.key : undefined });
      else seen[f].set(v, id);
    }
  }

  // similarity within a page type
  const similarity: ValidationResult['similarity'] = {};
  for (const type of ['compare', 'alternatives', 'migrate', 'industry', 'use-case'] as PageType[]) {
    const group = pages.filter((p) => p.type === type);
    if (group.length < 2) continue;
    const rep = similarityReport(group.map((p) => ({ id: p.path, text: textOfPage(p, { skip: ['sources'] }) })));
    similarity[type] = rep;
    for (const pr of rep.pairs) {
      if (pr.jaccard > SIMILARITY.maxPairJaccard) issues.push({ severity: 'error', code: 'TOO_SIMILAR', where: pr.a, message: `${(pr.jaccard * 100).toFixed(0)}% shingle overlap with ${pr.b} (limit ${SIMILARITY.maxPairJaccard * 100}%)`, key: group.find((g) => g.path === pr.a)?.key });
      else if (pr.jaccard > SIMILARITY.warnPairJaccard) issues.push({ severity: 'warning', code: 'SIMILAR', where: pr.a, message: `${(pr.jaccard * 100).toFixed(0)}% shingle overlap with ${pr.b}` });
    }
    for (const u of rep.unique) {
      if (u.share < SIMILARITY.minUniqueShare) issues.push({ severity: 'error', code: 'LOW_UNIQUE_SHARE', where: u.id, message: `only ${(u.share * 100).toFixed(0)}% of its text is unique among ${type} pages (minimum ${SIMILARITY.minUniqueShare * 100}%)`, key: group.find((g) => g.path === u.id)?.key });
      else if (u.share < SIMILARITY.warnUniqueShare) issues.push({ severity: 'warning', code: 'LOW_UNIQUE_SHARE', where: u.id, message: `${(u.share * 100).toFixed(0)}% unique among ${type} pages` });
    }
  }

  // alternatives need other options from the dataset
  const active = lib.competitors.filter((c) => c.status === 'active');
  const need = Math.min(2, active.length - 1);
  for (const p of pages.filter((x) => x.type === 'alternatives')) {
    const cards = p.blocks.find((b) => b.kind === 'cards');
    const n = cards && cards.kind === 'cards' ? cards.items.length - 1 : 0;
    if (n < need) issues.push({ severity: 'error', code: 'ALTERNATIVES_TOO_FEW', where: p.path, message: `lists ${n} other alternatives, needs ${need}`, key: p.key });
  }

  // migration cap
  if (migrationCompetitors(lib).length > MIGRATE_CAP) issues.push({ severity: 'error', code: 'MIGRATE_CAP', where: '/migrate', message: `more than ${MIGRATE_CAP} migration pages` });

  // publish.json entries must name something that exists, and a published page must be clean
  const keys = new Set(pages.map((p) => p.key));
  const slugs = new Set(pages.map((p) => p.slug));
  for (const entry of lib.publish.published) {
    if (!keys.has(entry) && !slugs.has(entry)) issues.push({ severity: 'error', code: 'PUBLISH_UNKNOWN', where: 'publish.json', message: `"${entry}" matches no page` });
  }
  const publishedWithErrors = new Set(issues.filter((i) => i.severity === 'error' && i.key && isPublished(lib.publish, keyType(i.key), keySlug(i.key))).map((i) => i.key));
  for (const k of publishedWithErrors) issues.push({ severity: 'error', code: 'PUBLISHED_PAGE_HAS_ERRORS', where: k!, message: 'this page is published but has validation errors above' });

  // every link on every page points at a page that exists
  const known = new Set<string>(['/', '/pricing', '/demo', '/docs', '/compare', ...pages.map((p) => p.path), ...hubs.map((h) => h.path)]);
  for (const p of pages) for (const b of p.blocks) if (b.kind === 'links') for (const l of b.items) if (!known.has(l.href)) issues.push({ severity: 'error', code: 'LINK_BROKEN', where: p.path, message: `links to ${l.href}, which is not a page`, key: p.key });

  return { issues, errors: issues.filter((i) => i.severity === 'error'), warnings: issues.filter((i) => i.severity === 'warning'), pages, similarity };
}

const KEY_TYPE: Record<string, PageType> = { compare: 'compare', alternatives: 'alternatives', migrate: 'migrate', industries: 'industry', 'use-cases': 'use-case' };
function keyType(key: string): PageType { return KEY_TYPE[key.split(':')[0]]; }
function keySlug(key: string): string { return key.split(':')[1]; }

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.severity.toUpperCase()} ${i.code} ${i.where}: ${i.message}`).join('\n');
}
