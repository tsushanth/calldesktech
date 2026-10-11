import fs from 'node:fs';
import path from 'node:path';
import { isPublished } from './publish';
import type { PublishList } from './schema';

// Old hand-written /compare/<slug> pages (the entries in src/lib/compareData.ts) are replaced by the sourced library page
// /compare/calldesk-vs-<slug> once that page is published in src/content/publish.json. Until then the old page is served as before.
//
// This file must stay free of "@/..." imports: next.config.ts loads it with a relative path to build the redirect table, and test
// test/lib/seoLibrary/redirects.test.ts checks HAND_WRITTEN_COMPARE_SLUGS against compareData so the two cannot drift apart.
//
// Not listed on purpose: the static pages /compare/retell, /compare/thunderphone and /compare/build-your-own. They hold the live
// benchmark write-ups, they are not data-driven, and replacing them needs a separate owner decision.

export const HAND_WRITTEN_COMPARE_SLUGS: readonly string[] = [
  'vapi', 'bland-ai', 'elevenlabs-agents', 'smith-ai', 'goodcall', 'synthflow', 'phonely', 'telnyx', 'thoughtly', 'livekit-cloud', 'pipecat-cloud', 'plivo-voice-ai',
];

/** Old slugs whose library page exists (an active competitor with the same slug) and is published. */
export function replacedCompareSlugs(publish: PublishList, activeLibrarySlugs: readonly string[], oldSlugs: readonly string[] = HAND_WRITTEN_COMPARE_SLUGS): string[] {
  return oldSlugs.filter((s) => activeLibrarySlugs.includes(s) && isPublished(publish, 'compare', s));
}

export type Redirect = { source: string; destination: string; permanent: true };

export function compareRedirects(publish: PublishList, activeLibrarySlugs: readonly string[], oldSlugs: readonly string[] = HAND_WRITTEN_COMPARE_SLUGS): Redirect[] {
  return replacedCompareSlugs(publish, activeLibrarySlugs, oldSlugs).map((s) => ({ source: `/compare/${s}`, destination: `/compare/calldesk-vs-${s}`, permanent: true as const }));
}

/** For next.config.ts: read the publish list and the active competitor slugs straight from src/content, at build time. */
export function compareRedirectsFromDisk(root: string = process.cwd()): Redirect[] {
  const dir = path.join(root, 'src', 'content');
  const publish = JSON.parse(fs.readFileSync(path.join(dir, 'publish.json'), 'utf8')) as PublishList;
  const compDir = path.join(dir, 'competitors');
  const active: string[] = [];
  for (const f of fs.readdirSync(compDir)) {
    if (!f.endsWith('.json')) continue;
    const c = JSON.parse(fs.readFileSync(path.join(compDir, f), 'utf8')) as { slug?: string; status?: string };
    if (c.slug && c.status === 'active') active.push(c.slug);
  }
  return compareRedirects(publish, active);
}
