import { COMPETITORS } from '@/lib/compareData';
import { allPages, hubChildren, pageIsPublished } from './index';
import { absoluteUrl } from './routes';

export type SitemapEntry = { url: string; lastModified?: string };

// Existing marketing pages. There was no sitemap before the library, so these are listed here once; add a page here when it ships.
const CORE_PATHS = ['/', '/pricing', '/compare', '/docs', '/docs/highlevel', '/demo', '/partners', '/compare/retell', '/compare/thunderphone', '/compare/build-your-own'];

/**
 * Sitemap entries: the core pages plus library pages that are in src/content/publish.json. An unpublished page, and a hub with no
 * published children, is never listed (it is also noindex).
 */
export function sitemapEntries(): SitemapEntry[] {
  const out: SitemapEntry[] = [...CORE_PATHS, ...COMPETITORS.map((c) => `/compare/${c.slug}`)].map((p) => ({ url: absoluteUrl(p) }));
  for (const p of allPages()) if (pageIsPublished(p)) out.push({ url: absoluteUrl(p.path), lastModified: p.lastVerified });
  for (const hub of ['alternatives', 'migrate', 'industries', 'use-cases'] as const) if (hubChildren(hub).length > 0) out.push({ url: absoluteUrl(`/${hub}`) });
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.url) ? false : (seen.add(e.url), true)));
}
