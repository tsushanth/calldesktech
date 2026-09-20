import * as cheerio from 'cheerio';
import { politeFetchText } from './http';

// Retell's public certified-partner directory (their own marketing page).
// Each card is an <a href="/partner/<slug>"> carrying data-partner-tier,
// data-location and data-price-range attributes plus the partner's name and
// blurb. One request per run.

export interface DirectoryPartner {
  slug: string;
  name: string;
  tier: string | null;
  location: string | null;
  priceRange: string | null;
  description: string | null;
}

const DIRECTORY_URL = 'https://www.retellai.com/partners';

export function parseDirectory(html: string): DirectoryPartner[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const partners: DirectoryPartner[] = [];

  $('a[href^="/partner/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const slug = href.replace('/partner/', '').replace(/\/$/, '');
    if (!slug || seen.has(slug)) return;

    const name = $el.find('.name-partners').first().text().trim();
    if (!name) return;
    seen.add(slug);

    partners.push({
      slug,
      name,
      tier: $el.attr('data-partner-tier')?.trim() || null,
      location: $el.attr('data-location')?.trim() || $el.attr('data-location-legacy')?.trim() || null,
      priceRange: $el.attr('data-price-range')?.trim() || null,
      description: $el.find('.text-14px').first().text().trim().slice(0, 600) || null,
    });
  });

  return partners;
}

export async function fetchDirectory(): Promise<DirectoryPartner[]> {
  const res = await politeFetchText(DIRECTORY_URL, 20000);
  if (!res.ok) throw new Error(`Retell partner directory request failed: ${res.status}`);
  return parseDirectory(res.text);
}
