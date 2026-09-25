// ra-cartesia-customers / ra-deepgram-customers: companies featured in a
// competing speech-API vendor's own customer case studies, i.e. known payers of
// a realtime STT/TTS API. Index page -> /customers/<slug> -> the customer's own
// website (every case study links it). robots.txt is honoured (both sites
// allow /customers/ as of 2026-09-25), requests are spaced 2s apart, and any
// block or challenge ends the source softly.
//
// Which vendor they pay is a SCORING fact only (signals), never the draft
// description: the offer rules forbid naming or disparaging competitors, and
// "we saw you in Deepgram's case study" is not something the email may say.

import * as cheerio from 'cheerio';
import { clip, decodeEntities, emptyResult, isVendorHost, nameFromDomain, orgDomain, reject, type RaHttp, type RaLead, type RaLoadResult } from './common';
import { compactName } from '../dedupe';

export type CompetitorVendor = 'cartesia' | 'deepgram';

export const VENDORS: Record<CompetitorVendor, { index: string; base: string; label: string; sourceId: 'ra-cartesia-customers' | 'ra-deepgram-customers' }> = {
  cartesia: { index: 'https://cartesia.ai/customers', base: 'https://cartesia.ai', label: 'Cartesia', sourceId: 'ra-cartesia-customers' },
  deepgram: { index: 'https://deepgram.com/customers', base: 'https://deepgram.com', label: 'Deepgram', sourceId: 'ra-deepgram-customers' },
};

// Anonymised case studies ("a Fortune 50 retail pharmacy") have no website to follow.
const ANONYMOUS_SLUG = /^(fortune-\d+|leading-|page-[0-9a-f]{8,}|a-|an-|global-|top-)/;

export function parseCustomerSlugs(html: string): string[] {
  const slugs = new Set<string>();
  for (const m of html.matchAll(/\/customers\/([a-z0-9][a-z0-9-]*)/g)) slugs.add(m[1]);
  return [...slugs].sort();
}

// Hosts that appear on case-study pages but are never the customer.
const CASE_STUDY_NOISE = [
  'googletagmanager.com', 'visualwebsiteoptimizer.com', 'sanity.io', 'luma.com', 'lu.ma', 'calendly.com', 'cal.com', 'status.io',
  'hubspot.com', 'hsforms.com', 'typeform.com', 'vimeo.com', 'wistia.net', 'cloudfront.net', 'amazonaws.com', 'webflow.com', 'website-files.com',
  'framer.com', 'framerusercontent.com', 'g2.com', 'gartner.com', 'techcrunch.com', 'businesswire.com', 'prnewswire.com', 'forbes.com',
  // CMS / asset CDNs (a case-study PDF link is not the customer's site)
  'datocms-assets.com', 'ctfassets.net', 'contentful.com', 'imgix.net', 'cloudinary.com', 'prismic.io', 'storyblok.com', 'jsdelivr.net', 'unpkg.com',
];
const ASSET_LINK = /\.(pdf|png|jpe?g|gif|svg|webp|mp4|mov|zip)(\?|#|$)/i;

// The customer's website: the most-linked external org host on the page, with
// a strong preference for a host whose name appears in the slug.
export function extractCustomerSite(html: string, vendor: CompetitorVendor, slug: string): { domain: string | null; name: string | null } {
  const $ = cheerio.load(html);
  const counts = new Map<string, { n: number; first: number }>();
  let i = 0;
  $('a[href^="http"]').each((_, el) => {
    const href = decodeEntities($(el).attr('href') || '');
    i++;
    if (ASSET_LINK.test(href)) return;
    const host = orgDomain(href);
    if (!host || isVendorHost(host) || host.endsWith(`${vendor}.ai`) || host.endsWith(`${vendor}.com`)) return;
    if (CASE_STUDY_NOISE.some((h) => host === h || host.endsWith(`.${h}`))) return;
    const cur = counts.get(host);
    if (cur) cur.n++; else counts.set(host, { n: 1, first: i });
  });
  const slugCompact = slug.replace(/[^a-z0-9]/g, '');
  let best: { host: string; score: number; first: number } | null = null;
  for (const [host, { n, first }] of counts) {
    const label = host.split('.')[0].replace(/[^a-z0-9]/g, '');
    const inSlug = label.length >= 3 && (slugCompact.startsWith(label) || slugCompact.includes(label));
    const score = n + (inSlug ? 10 : 0);
    if (!best || score > best.score || (score === best.score && first < best.first)) best = { host, score, first };
  }
  if (!best) return { domain: null, name: null };
  // Require either the slug naming the host or a repeated link: a single stray
  // link to an unrelated site (a related story) is not the customer.
  const label = best.host.split('.')[0].replace(/[^a-z0-9]/g, '');
  if (best.score < 2 && !(label.length >= 3 && slugCompact.includes(label))) return { domain: null, name: null };
  return { domain: best.host, name: nameFromHeading($('h1').first().text() || $('title').text(), best.host) };
}

// "ActOnCue's AI scene readers moved..." + actoncue.com -> "ActOnCue".
export function nameFromHeading(heading: string, domain: string): string {
  const label = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
  const words = decodeEntities(heading).replace(/^[^|]*\|\s*/, '').split(/\s+/).map((w) => w.replace(/['’]s$/i, '').replace(/[^\p{L}\p{N}.&-]/gu, ''));
  for (let a = 0; a < words.length; a++) {
    for (let b = a; b < Math.min(words.length, a + 4); b++) {
      const phrase = words.slice(a, b + 1).join(' ');
      if (compactName(phrase) === label) return phrase;
    }
  }
  return nameFromDomain(domain);
}

export function toCompetitorLead(vendor: CompetitorVendor, slug: string, site: { domain: string; name: string | null }): RaLead {
  const v = VENDORS[vendor];
  return {
    sourceId: v.sourceId,
    sourceKey: `readaloud:competitor-customer:${vendor}:${slug}`,
    name: clip(site.name ?? nameFromDomain(site.domain), 120) as string,
    domain: site.domain,
    location: null,
    description: null,
    signalSource: 'directory',
    signalDetail: `Featured customer case study on ${v.label} (${v.base}/customers/${slug})`,
    email: null,
    emailSourceUrl: null,
    source: {
      adjust: 25,
      reasons: [`+25: pays a competing speech API (${v.label} customer case study)`],
      facts: { vendor, caseStudy: `${v.base}/customers/${slug}` },
    },
  };
}

export async function loadCompetitorCustomers(
  vendor: CompetitorVendor, http: RaHttp, opts: { log?: (m: string) => void; max?: number } = {},
): Promise<RaLoadResult> {
  const v = VENDORS[vendor];
  const res = emptyResult();
  const index = await http.get(v.index, { minDelayMs: 2000, accept: 'text/html' });
  if (!index.ok) { res.errors.push(`${v.label} customers index: ${index.blocked ?? `HTTP ${index.status}`}`); return res; }
  const slugs = parseCustomerSlugs(index.text).slice(0, opts.max ?? 200);
  res.notes.push(`${slugs.length} case-study slugs on ${v.index}`);
  for (const slug of slugs) {
    res.scanned++;
    if (ANONYMOUS_SLUG.test(slug)) { reject(res, 'anonymised case study'); continue; }
    const page = await http.get(`${v.base}/customers/${slug}`, { minDelayMs: 2000, accept: 'text/html' });
    if (!page.ok) {
      if (page.blocked) { res.errors.push(`${v.label}/${slug}: ${page.blocked}`); if (/challenge|robots/.test(page.blocked)) break; }
      reject(res, `case study HTTP ${page.status}`);
      continue;
    }
    const site = extractCustomerSite(page.text, vendor, slug);
    if (!site.domain) { reject(res, 'no customer website on case study'); continue; }
    res.leads.push(toCompetitorLead(vendor, slug, { domain: site.domain, name: site.name }));
    opts.log?.(`${vendor}/${slug} -> ${site.domain}`);
  }
  return res;
}
