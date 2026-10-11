import { describe, it, expect } from 'vitest';
import { fixtureLibrary, NOW } from './helpers';
import { validateLibrary, formatIssues } from '@/lib/seoLibrary/validate';
import { SIMILARITY } from '@/lib/seoLibrary/similarity';
import { textOfPage, wordCount } from '@/lib/seoLibrary/text';

// The framework running against test/fixtures/seo-library: 2 competitors, 2 industries, 1 use case.
describe('fixture library', () => {
  const lib = fixtureLibrary();
  const result = validateLibrary(lib, NOW, { checkRelated: false });

  it('loads every fixture file through the schemas', () => {
    expect(lib.competitors.map((c) => c.slug)).toEqual(['retell-ai', 'vapi']);
    expect(lib.industries.map((c) => c.slug)).toEqual(['dental-offices', 'home-services']);
    expect(lib.useCases.map((c) => c.slug)).toEqual(['appointment-booking']);
    expect(lib.publish.published).toEqual([]);
  });

  it('builds the expected pages: compare, alternatives and migrate per competitor, plus content pages', () => {
    const counts = Object.fromEntries(['compare', 'alternatives', 'migrate', 'industry', 'use-case'].map((t) => [t, result.pages.filter((p) => p.type === t).length]));
    expect(counts).toEqual({ compare: 2, alternatives: 2, migrate: 2, industry: 2, 'use-case': 1 });
    expect(result.pages.map((p) => p.path)).toContain('/compare/calldesk-vs-vapi');
    expect(result.pages.map((p) => p.path)).toContain('/alternatives/retell-ai-alternatives');
    expect(result.pages.map((p) => p.path)).toContain('/migrate/from-vapi');
  });

  it('has no validation errors (related-slug resolution is skipped: 3 content pages cannot satisfy 4 related slugs)', () => {
    expect(formatIssues(result.errors)).toBe('');
  });

  it('reports page sizes and similarity so thresholds can be judged', () => {
    const rows = result.pages.map((p) => `${p.path}: ${wordCount(textOfPage(p, { skip: ['sources'] }))} words`);
    const sim = Object.entries(result.similarity).map(([t, r]) => `${t}: max jaccard ${r.maxJaccard.toFixed(2)}, min unique ${r.minUnique.toFixed(2)}`);
    console.log(`\n${rows.join('\n')}\n${sim.join('\n')}\nthresholds: jaccard <= ${SIMILARITY.maxPairJaccard}, unique >= ${SIMILARITY.minUniqueShare}\nwarnings:\n${formatIssues(result.warnings)}`);
    for (const r of Object.values(result.similarity)) {
      expect(r.maxJaccard).toBeLessThanOrEqual(SIMILARITY.maxPairJaccard);
      expect(r.minUnique).toBeGreaterThanOrEqual(SIMILARITY.minUniqueShare);
    }
  });

  it('every page has a distinct title and description', () => {
    expect(new Set(result.pages.map((p) => p.title)).size).toBe(result.pages.length);
    expect(new Set(result.pages.map((p) => p.description)).size).toBe(result.pages.length);
  });
});
