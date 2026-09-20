import * as cheerio from 'cheerio';
import { politeFetchText } from './http';

// A Retell partner profile links to the agency's own site (the link carries
// utm_source=retell_ai). Returns the bare domain, or null if none is found.

const SKIP_HOSTS = ['retellai.com', 'cal.com', 'calendly.com', 'discord.com', 'linkedin.com', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'brevo.com', 'intellimize', 'jsdelivr.net', 'website-files.com', 'webflow.com', 'google.com'];

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function extractWebsite(html: string): string | null {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('a[href^="http"]').each((_, el) => {
    links.push(($(el).attr('href') || '').replace(/&amp;/g, '&'));
  });

  const utm = links.find((l) => l.includes('utm_source=retell_ai'));
  if (utm) return hostOf(utm);

  for (const l of links) {
    const host = hostOf(l);
    if (host && !SKIP_HOSTS.some((s) => host.includes(s))) return host;
  }
  return null;
}

export async function findAgencyDomain(slug: string): Promise<string | null> {
  const res = await politeFetchText(`https://www.retellai.com/partner/${slug}`);
  if (!res.ok) return null;
  return extractWebsite(res.text);
}
