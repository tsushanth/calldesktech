import { loadLibrary, type Library } from './load';
import { hubModels, migrationCompetitors } from './pages';
import { formatIssues, validateLibrary, type Issue, type ValidationResult } from './validate';
import { isPublished } from './publish';
import type { HubModel, HubType, LibraryPageModel, PageType } from './model';
import { slugFromSegment } from './routes';

// The entry point for routes and the sitemap. Content is read once per process (at build time for statically generated pages).
//
// Build gate: during `next build`, a schema error always fails the build (load.ts), and so does any validation ERROR that belongs to a
// PUBLISHED page or to a competitor/industry/use case whose pages are published. Errors on unpublished pages are reported by the
// test suite (test/lib/seoLibrary) but do not stop a deploy, because those pages are noindex and unlinked.

let cache: { lib: Library; result: ValidationResult } | null = null;

function affectsPublished(lib: Library, i: Issue): boolean {
  if (i.key) {
    const [kind, slug] = i.key.split(':');
    const type: PageType = kind === 'industries' ? 'industry' : kind === 'use-cases' ? 'use-case' : (kind as PageType);
    return isPublished(lib.publish, type, slug);
  }
  const m = /^(competitors|industries|use-cases)\/(.+)$/.exec(i.where);
  if (m) {
    const slug = m[2];
    if (m[1] === 'competitors') return (['compare', 'alternatives', 'migrate'] as PageType[]).some((t) => isPublished(lib.publish, t, slug));
    return isPublished(lib.publish, m[1] === 'industries' ? 'industry' : 'use-case', slug);
  }
  return i.where === 'publish.json';
}

export function getLibrary(): { lib: Library; result: ValidationResult } {
  if (cache) return cache;
  const lib = loadLibrary();
  const result = validateLibrary(lib);
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    const blocking = result.errors.filter((i) => affectsPublished(lib, i));
    if (blocking.length) throw new Error(`Library validation failed for published content:\n${formatIssues(blocking)}`);
  }
  cache = { lib, result };
  return cache;
}

export function resetLibraryCache() { cache = null; }

/** Tests: serve a library built in memory instead of reading src/content. */
export function setLibraryForTests(lib: Library | null, opts: { checkRelated?: boolean } = {}) {
  cache = lib ? { lib, result: validateLibrary(lib, new Date(), opts) } : null;
}

export function allPages(): LibraryPageModel[] { return getLibrary().result.pages; }

export function pagesOfType(type: PageType): LibraryPageModel[] { return allPages().filter((p) => p.type === type); }

export function findPage(type: PageType, segment: string): LibraryPageModel | undefined {
  const slug = type === 'industry' || type === 'use-case' ? segment : slugFromSegment(type, segment);
  return slug ? allPages().find((p) => p.type === type && p.slug === slug) : undefined;
}

export function pageIsPublished(p: LibraryPageModel): boolean {
  const { lib } = getLibrary();
  return isPublished(lib.publish, p.type, p.slug);
}

export function publishedPages(): LibraryPageModel[] { return allPages().filter(pageIsPublished); }

const HUB_TYPES: Record<Exclude<HubType, 'compare'>, PageType> = { alternatives: 'alternatives', migrate: 'migrate', industries: 'industry', 'use-cases': 'use-case' };

export function hubChildren(hub: Exclude<HubType, 'compare'> | 'compare'): LibraryPageModel[] {
  const type: PageType = hub === 'compare' ? 'compare' : HUB_TYPES[hub];
  return publishedPages().filter((p) => p.type === type);
}

/** A hub is indexable once at least one child is published. */
export function hubModel(hub: Exclude<HubType, 'compare'>): { model: HubModel; children: LibraryPageModel[]; indexed: boolean } {
  const children = hubChildren(hub);
  return { model: hubModels()[hub], children, indexed: children.length > 0 };
}

export { migrationCompetitors };
