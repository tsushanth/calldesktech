import type { PublishList } from './schema';
import type { PageType } from './model';

// Wave publishing. src/content/publish.json = { "published": [ ... ] } lists what search engines may index.
// An entry is either
//   "vapi"                  every page that slug can have: compare, alternatives and migrate for the competitor "vapi", or the
//                           industry or use case of that slug
//   "compare:vapi"          one page type only (compare | alternatives | migrate | industries | use-cases)
// A page not listed still renders (preview by URL) but is noindex, left out of the sitemap, and not linked from hubs or related lists.

const KIND: Record<PageType, string> = { compare: 'compare', alternatives: 'alternatives', migrate: 'migrate', industry: 'industries', 'use-case': 'use-cases' };

export function publishKey(type: PageType, slug: string): string {
  return `${KIND[type]}:${slug}`;
}

export function isPublished(list: PublishList, type: PageType, slug: string): boolean {
  return list.published.includes(slug) || list.published.includes(publishKey(type, slug));
}
