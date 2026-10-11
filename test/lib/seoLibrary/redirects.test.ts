import { describe, it, expect } from 'vitest';
import { COMPETITORS } from '@/lib/compareData';
import { HAND_WRITTEN_COMPARE_SLUGS, compareRedirects, compareRedirectsFromDisk, replacedCompareSlugs } from '@/lib/seoLibrary/redirects';
import { loadLibrary, DEFAULT_CONTENT_DIR } from '@/lib/seoLibrary/load';
import { sitemapEntries } from '@/lib/seoLibrary/sitemapEntries';
import { setLibraryForTests } from '@/lib/seoLibrary';

const active = ['vapi', 'bland-ai', 'retell-ai', 'thunderphone', 'parloa'];

describe('redirect of old hand-written /compare/<slug> pages', () => {
  it('lists exactly the slugs in compareData', () => {
    expect([...HAND_WRITTEN_COMPARE_SLUGS].sort()).toEqual(COMPETITORS.map((c) => c.slug).sort());
  });
  it('published -> permanent redirect to the new page', () => {
    expect(compareRedirects({ published: ['compare:vapi'] }, active)).toEqual([{ source: '/compare/vapi', destination: '/compare/calldesk-vs-vapi', permanent: true }]);
    expect(compareRedirects({ published: ['bland-ai'] }, active)).toEqual([{ source: '/compare/bland-ai', destination: '/compare/calldesk-vs-bland-ai', permanent: true }]);
  });
  it('unpublished -> no redirect, the old page is still served', () => {
    expect(compareRedirects({ published: [] }, active)).toEqual([]);
    // another page type published for the same competitor does not trigger it
    expect(compareRedirects({ published: ['alternatives:vapi', 'migrate:vapi'] }, active)).toEqual([]);
  });
  it('an old page whose replacement does not exist is never redirected', () => {
    expect(replacedCompareSlugs({ published: ['compare:goodcall'] }, active)).toEqual([]);
  });
  it('old pages that are not replaced keep working (never in the table)', () => {
    const r = compareRedirects({ published: ['compare:vapi', 'compare:thunderphone', 'compare:retell-ai'] }, active).map((x) => x.source);
    expect(r).toEqual(['/compare/vapi']);
    expect(r).not.toContain('/compare/retell');
    expect(r).not.toContain('/compare/thunderphone');
  });
  it('the table next.config builds from src/content matches the published list', () => {
    const lib = loadLibrary(DEFAULT_CONTENT_DIR);
    const expected = HAND_WRITTEN_COMPARE_SLUGS.filter((s) => lib.competitors.some((c) => c.slug === s && c.status === 'active') && (lib.publish.published.includes(s) || lib.publish.published.includes(`compare:${s}`)));
    expect(compareRedirectsFromDisk().map((r) => r.source)).toEqual(expected.map((s) => `/compare/${s}`));
  });
  it('the sitemap lists a redirected old page only while it is not replaced', () => {
    const lib = loadLibrary(DEFAULT_CONTENT_DIR);
    setLibraryForTests({ ...lib, publish: { published: ['compare:vapi'] } });
    const on = sitemapEntries().map((e) => e.url);
    expect(on).toContain('https://calldesk.tech/compare/calldesk-vs-vapi');
    expect(on).not.toContain('https://calldesk.tech/compare/vapi');
    expect(on).toContain('https://calldesk.tech/compare/bland-ai');
    setLibraryForTests({ ...lib, publish: { published: [] } });
    const off = sitemapEntries().map((e) => e.url);
    expect(off).toContain('https://calldesk.tech/compare/vapi');
    expect(off).not.toContain('https://calldesk.tech/compare/calldesk-vs-vapi');
    setLibraryForTests(null);
  });
});
