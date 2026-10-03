// ra-elevenlabs-customers: companies featured in a competing speech-API
// vendor's customer stories, i.e. known payers of a TTS/STT/agents API. Same
// shape as competitorCustomers.ts, but this vendor's index lives at
// /customer-stories and the story pages live under /blog/<slug>:
//   index (/customer-stories) -> /blog/<slug> -> the customer's own website.
// robots.txt is honoured (the `*` group allows both paths as of 2026-10-02),
// requests are spaced 2s apart, and any block or challenge ends the source
// softly. The index renders the first page of stories server-side and the rest
// behind a client-side "Load More"; only what the HTML contains is read.
//
// Which vendor a company pays is a SCORING fact only (signals), never the draft
// description: the offer rules forbid naming or disparaging competitors, and
// "we saw you in <vendor>'s case study" is not something the email may say.
//
// Very large enterprises are scored DOWN: they are not realistic API switchers
// (procurement, existing enterprise contracts), so a small or mid-size customer
// outranks them.

import * as cheerio from 'cheerio';
import { clip, decodeEntities, emptyResult, isVendorHost, nameFromDomain, orgDomain, reject, type RaHttp, type RaLead, type RaLoadResult } from './common';
import { ASSET_LINK, CASE_STUDY_NOISE, nameFromHeading } from './competitorCustomers';

export const ELEVENLABS_INDEX = 'https://elevenlabs.io/customer-stories';
export const ELEVENLABS_BASE = 'https://elevenlabs.io';

// Registrable domains of very large enterprises / big-tech platforms. Mid-size
// names (Chess.com, Harvey, Fyxer, ...) are deliberately NOT here.
export const LARGE_ENTERPRISE_DOMAINS = [
  'meta.com', 'facebook.com', 'vimeo.com', 'telekom.com', 'telekom.de', 'twilio.com', 'alpha.gr', 'klarna.com', 'revolut.com',
  'deliveroo.com', 'deliveroo.co.uk', 'allegro.pl', 'allegro.com', 'cisco.com', 'webex.com', 'nvidia.com', 'ibm.com', 'kpn.com', 'telus.com',
  'telusdigital.com', 'telusinternational.com', 'havells.com', 'salesforce.com', 'google.com', 'microsoft.com', 'amazon.com', 'aws.amazon.com',
  'oracle.com', 'sap.com', 'samsung.com', 'sony.com', 'disney.com', 'verizon.com', 'att.com', 't-mobile.com', 'vodafone.com', 'orange.com',
  'telefonica.com', 'webex.ai', 'siemens.com', 'hsbc.com', 'jpmorgan.com', 'paypal.com', 'uber.com', 'doordash.com', 'spotify.com', 'netflix.com',
];

// Social / link-in-footer hosts that are not in the shared generic list and are never the customer.
const SOCIAL_NOISE = ['tiktok.com', 'snapchat.com', 'pinterest.com', 'threads.net', 'whatsapp.com', 'podcasts.apple.com', 'twitch.tv', 'cookiebot.com', 'usercentrics.com'];

// Slugs of partner/launch posts that are not customer stories at all.
const NON_STORY_SLUG = /(^|-)(partners?|partnership|announce|announces|launch|launches|introducing|raises|funding)(-|$)/;

export function parseStorySlugs(html: string): string[] {
  const slugs = new Set<string>();
  for (const m of html.matchAll(/href="(?:https?:\/\/elevenlabs\.io)?\/blog\/([a-z0-9][a-z0-9-]*)"/g)) slugs.add(m[1]);
  return [...slugs];
}

export function isLargeEnterprise(domain: string): boolean {
  return LARGE_ENTERPRISE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

// The customer's website on a story page: the external organisation host the
// page links most (preferring one named in the slug). Vendor, social, CDN and
// press hosts are ignored. A lone remaining host is accepted: story pages carry
// exactly one customer link, and every other external link is vendor/social.
export function extractStoryCustomer(html: string, slug: string): { domain: string | null; name: string | null; heading: string; agents: boolean } {
  const $ = cheerio.load(html);
  const heading = ($('h1').first().text() || $('title').text()).replace(/\s+/g, ' ').trim();
  const agents = /\beleven\s?agents?\b|\bconversational ai\b|\bvoice agents?\b/i.test(`${heading} ${$('meta[name=description]').attr('content') ?? ''}`);
  const counts = new Map<string, { n: number; first: number }>();
  let i = 0;
  $('a[href^="http"]').each((_, el) => {
    const href = decodeEntities($(el).attr('href') || '');
    i++;
    if (ASSET_LINK.test(href)) return;
    const host = orgDomain(href);
    if (!host || isVendorHost(host) || host.endsWith('elevenlabs.io') || host.endsWith('elevenlabs.com')) return;
    if ([...CASE_STUDY_NOISE, ...SOCIAL_NOISE].some((h) => host === h || host.endsWith(`.${h}`))) return;
    const cur = counts.get(host);
    if (cur) cur.n++; else counts.set(host, { n: 1, first: i });
  });
  const slugCompact = slug.replace(/[^a-z0-9]/g, '');
  let best: { host: string; score: number; first: number } | null = null;
  for (const [host, { n, first }] of counts) {
    const label = host.split('.')[0].replace(/[^a-z0-9]/g, '');
    const inSlug = label.length >= 3 && slugCompact.includes(label);
    const score = n + (inSlug ? 10 : 0);
    if (!best || score > best.score || (score === best.score && first < best.first)) best = { host, score, first };
  }
  if (!best) return { domain: null, name: null, heading, agents };
  const label = best.host.split('.')[0].replace(/[^a-z0-9]/g, '');
  const trusted = best.score >= 2 || (label.length >= 3 && slugCompact.includes(label)) || counts.size === 1;
  if (!trusted) return { domain: null, name: null, heading, agents };
  const headline = heading.replace(/^(how|why)\s+/i, '');
  let name = nameFromHeading(headline, best.host);
  // The domain is often the name plus a word (finchlegal.com for "Finch"): prefer the headline's first word then.
  const first = headline.split(/\s+/)[0]?.replace(/['\u2019]s$/i, '').replace(/[^\p{L}\p{N}.&-]/gu, '') ?? '';
  if (name === nameFromDomain(best.host) && first.length >= 3 && label.startsWith(first.toLowerCase().replace(/[^a-z0-9]/g, ''))) name = first;
  return { domain: best.host, name, heading, agents };
}

export function toElevenlabsLead(slug: string, site: { domain: string; name: string | null; agents: boolean }): RaLead {
  const large = isLargeEnterprise(site.domain);
  const adjust = large ? -10 : 20;
  const reasons = large
    ? ['+20: pays a competing speech API (customer story)', '-30: very large enterprise (not a realistic API switcher)']
    : ['+20: pays a competing speech API (customer story)'];
  return {
    sourceId: 'ra-elevenlabs-customers',
    sourceKey: `readaloud:competitor-customer:elevenlabs:${slug}`,
    name: clip(site.name ?? nameFromDomain(site.domain), 120) as string,
    domain: site.domain,
    location: null,
    description: null,
    signalSource: 'directory',
    signalDetail: `Featured customer story on ElevenLabs (${ELEVENLABS_BASE}/blog/${slug})`,
    email: null,
    emailSourceUrl: null,
    source: {
      adjust,
      reasons,
      facts: { vendor: 'elevenlabs', caseStudy: `${ELEVENLABS_BASE}/blog/${slug}`, product: site.agents ? 'agents' : 'api', largeEnterprise: large },
    },
  };
}

export async function loadElevenlabsCustomers(http: RaHttp, opts: { log?: (m: string) => void; max?: number } = {}): Promise<RaLoadResult> {
  const res = emptyResult();
  const index = await http.get(ELEVENLABS_INDEX, { minDelayMs: 2000, accept: 'text/html' });
  if (!index.ok) { res.errors.push(`ElevenLabs customer stories index: ${index.blocked ?? `HTTP ${index.status}`}`); return res; }
  const slugs = parseStorySlugs(index.text).slice(0, opts.max ?? 200);
  res.notes.push(`${slugs.length} customer-story slugs on ${ELEVENLABS_INDEX} (server-rendered page only; "Load More" entries are not fetched)`);
  for (const slug of slugs) {
    res.scanned++;
    if (NON_STORY_SLUG.test(slug)) { reject(res, 'partner/launch post, not a customer story'); continue; }
    const page = await http.get(`${ELEVENLABS_BASE}/blog/${slug}`, { minDelayMs: 2000, accept: 'text/html' });
    if (!page.ok) {
      if (page.blocked) { res.errors.push(`elevenlabs/${slug}: ${page.blocked}`); if (/challenge|robots/.test(page.blocked)) break; }
      reject(res, `case study HTTP ${page.status}`);
      continue;
    }
    const site = extractStoryCustomer(page.text, slug);
    if (!site.domain) { reject(res, 'no customer website on story'); continue; }
    res.leads.push(toElevenlabsLead(slug, { domain: site.domain, name: site.name, agents: site.agents }));
    opts.log?.(`elevenlabs/${slug} -> ${site.domain}`);
  }
  return res;
}
