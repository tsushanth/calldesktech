import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadLibrary, DEFAULT_CONTENT_DIR } from '@/lib/seoLibrary/load';
import { validateLibrary, formatIssues } from '@/lib/seoLibrary/validate';
import { PublishSchema } from '@/lib/seoLibrary/schema';

// The same gate, run against the real files in src/content once the research and content branches are merged. With no files yet the
// library is empty and these pass trivially; the moment any competitor, industry or use-case file lands, every rule applies to it.
// NOTE: `new Date()` is used on purpose here (unlike the fixture tests): a competitor record older than 90 days gets a STALE warning.
describe('real content in src/content', () => {
  const lib = loadLibrary(DEFAULT_CONTENT_DIR);
  const result = validateLibrary(lib, new Date());

  it('publish.json exists and parses', () => {
    const f = path.join(DEFAULT_CONTENT_DIR, 'publish.json');
    expect(fs.existsSync(f)).toBe(true);
    expect(PublishSchema.safeParse(JSON.parse(fs.readFileSync(f, 'utf8'))).success).toBe(true);
  });

  it('every file loads through its schema (the loader throws otherwise) and reports its size', () => {
    const active = lib.competitors.filter((c) => c.status === 'active').length;
    console.log(`real content: ${lib.competitors.length} competitors (${active} active), ${lib.industries.length} industries, ${lib.useCases.length} use cases, ${result.pages.length} pages, ${lib.publish.published.length} published entries`);
    expect(lib.competitors.length).toBeLessThanOrEqual(24);
    expect(lib.industries.length).toBeLessThanOrEqual(25);
    expect(lib.useCases.length).toBeLessThanOrEqual(15);
  });

  it('passes every quality rule (sources, dates, wording, certifications, uniqueness, similarity, thin pages, links)', () => {
    if (result.warnings.length) console.log(`warnings:\n${formatIssues(result.warnings)}`);
    expect(formatIssues(result.errors)).toBe('');
  });
});
