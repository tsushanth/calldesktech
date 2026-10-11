import { CALLDESK_SITE } from '@/content/calldeskFacts';
import type { PageType } from './model';

// URL scheme. Paths are built here and nowhere else.
export const SITE_URL = CALLDESK_SITE;

export const compareSlug = (c: string) => `calldesk-vs-${c}`;
export const alternativesSlug = (c: string) => `${c}-alternatives`;
export const migrateSlug = (c: string) => `from-${c}`;

export const paths = {
  compare: (c: string) => `/compare/${compareSlug(c)}`,
  alternatives: (c: string) => `/alternatives/${alternativesSlug(c)}`,
  migrate: (c: string) => `/migrate/${migrateSlug(c)}`,
  industry: (s: string) => `/industries/${s}`,
  useCase: (s: string) => `/use-cases/${s}`,
};

export const pathFor = (type: PageType, slug: string): string =>
  type === 'compare' ? paths.compare(slug) : type === 'alternatives' ? paths.alternatives(slug) : type === 'migrate' ? paths.migrate(slug) : type === 'industry' ? paths.industry(slug) : paths.useCase(slug);

export const absoluteUrl = (p: string) => `${SITE_URL}${p}`;

/** Prefix of each route's dynamic segment, to turn a URL segment back into a content slug (null when it does not match). */
export function slugFromSegment(type: PageType, segment: string): string | null {
  const pre = type === 'compare' ? 'calldesk-vs-' : type === 'migrate' ? 'from-' : '';
  const suf = type === 'alternatives' ? '-alternatives' : '';
  if (!segment.startsWith(pre) || !segment.endsWith(suf)) return null;
  const s = segment.slice(pre.length, segment.length - suf.length);
  return s || null;
}

/** The order migration pages are built in; capped. Competitors outside this list fill any remaining places alphabetically. */
export const MIGRATE_PRIORITY = ['vapi', 'retell-ai', 'bland-ai', 'synthflow', 'elevenlabs-agents', 'thunderphone', 'phonely', 'air-ai', 'goodcall', 'voiceflow', 'bolna', 'ultravox'];
export const MIGRATE_CAP = 12;
