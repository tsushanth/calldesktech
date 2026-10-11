import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fixtureLibrary, clone, NOW } from './helpers';
import { LibraryPageView, HubView } from '@/components/library/LibraryPage';
import { allPages, findPage, hubModel, pageIsPublished, publishedPages, setLibraryForTests } from '@/lib/seoLibrary';
import { metadataFor } from '@/lib/seoLibrary/seo';
import { sitemapEntries } from '@/lib/seoLibrary/sitemapEntries';
import { isPublished } from '@/lib/seoLibrary/publish';
import { migrationCompetitors } from '@/lib/seoLibrary/pages';
import { MIGRATE_CAP, MIGRATE_PRIORITY, slugFromSegment } from '@/lib/seoLibrary/routes';
import type { Library } from '@/lib/seoLibrary/load';

const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const lib = (publish: string[] = []): Library => { const l = clone(fixtureLibrary()); l.publish = { published: publish }; return l; };
const load = (l: Library) => setLibraryForTests(l, { checkRelated: false });
afterEach(() => setLibraryForTests(null));

describe('route slugs', () => {
  it('maps URL segments back to content slugs', () => {
    expect(slugFromSegment('compare', 'calldesk-vs-vapi')).toBe('vapi');
    expect(slugFromSegment('alternatives', 'retell-ai-alternatives')).toBe('retell-ai');
    expect(slugFromSegment('migrate', 'from-vapi')).toBe('vapi');
    expect(slugFromSegment('compare', 'vapi')).toBeNull();
    expect(slugFromSegment('migrate', 'vapi')).toBeNull();
  });
});

describe('wave publishing', () => {
  it('with an empty publish list every page renders but is noindex, and the sitemap has none of them', () => {
    load(lib());
    expect(allPages().length).toBe(9);
    expect(publishedPages()).toEqual([]);
    for (const p of allPages()) {
      expect(metadataFor(p, pageIsPublished(p)).robots).toEqual({ index: false });
      expect(renderToStaticMarkup(createElement(LibraryPageView, { page: p, indexed: false }))).toContain('Preview: this page is not published');
    }
    const urls = sitemapEntries().map((e) => e.url);
    for (const p of allPages()) expect(urls).not.toContain(`https://calldesk.tech${p.path}`);
    expect(urls.some((u) => /\/(alternatives|migrate|industries|use-cases)$/.test(u))).toBe(false);
  });

  it('a bare slug publishes every page that slug has; a typed entry publishes one', () => {
    load(lib(['vapi', 'alternatives:retell-ai', 'industries:dental-offices']));
    const pub = publishedPages().map((p) => p.path).sort();
    expect(pub).toEqual(['/alternatives/retell-ai-alternatives', '/compare/calldesk-vs-vapi', '/alternatives/vapi-alternatives', '/industries/dental-offices', '/migrate/from-vapi'].sort());
    const urls = sitemapEntries().map((e) => e.url);
    expect(urls).toContain('https://calldesk.tech/compare/calldesk-vs-vapi');
    expect(urls).toContain('https://calldesk.tech/alternatives');
    expect(urls).toContain('https://calldesk.tech/industries');
    expect(urls).not.toContain('https://calldesk.tech/use-cases');
    expect(urls).not.toContain('https://calldesk.tech/compare/calldesk-vs-retell-ai');
    expect(metadataFor(findPage('compare', 'calldesk-vs-vapi')!, true).robots).toBeUndefined();
  });

  it('hubs list published children only, and are indexed only when they have one', () => {
    load(lib(['industries:dental-offices']));
    const h = hubModel('industries');
    expect(h.children.map((c) => c.slug)).toEqual(['dental-offices']);
    expect(h.indexed).toBe(true);
    expect(hubModel('migrate').indexed).toBe(false);
    const html = renderToStaticMarkup(createElement(HubView, { hub: h.model, items: h.children.map((c) => ({ href: c.path, title: c.h1, text: c.lede })), indexed: true, emptyNote: 'none' }));
    expect(html).toContain('/industries/dental-offices');
    expect(html).not.toContain('/industries/home-services');
  });

  it('internal links on a page point at published pages only', () => {
    load(lib(['compare:vapi']));
    const page = findPage('compare', 'calldesk-vs-vapi')!;
    const html = renderToStaticMarkup(createElement(LibraryPageView, { page, indexed: true }));
    expect(html).not.toContain('/alternatives/vapi-alternatives');
    load(lib(['vapi', 'alternatives:retell-ai']));
    const html2 = renderToStaticMarkup(createElement(LibraryPageView, { page: findPage('compare', 'calldesk-vs-vapi')!, indexed: true }));
    expect(html2).toContain('/alternatives/vapi-alternatives');
    expect(html2).toContain('/migrate/from-vapi');
    expect(isPublished(lib(['vapi']).publish, 'compare', 'vapi')).toBe(true);
  });
});

describe('rendered pages', () => {
  const html = (type: Parameters<typeof findPage>[0], seg: string) => renderToStaticMarkup(createElement(LibraryPageView, { page: findPage(type, seg)!, indexed: true }));
  it('a competitor page has BreadcrumbList, no FAQPage, a canonical, OpenGraph, sources, the verified date and the corrections note', () => {
    load(lib(['vapi']));
    const page = findPage('compare', 'calldesk-vs-vapi')!;
    const out = html('compare', 'calldesk-vs-vapi');
    expect(out).toContain('"@type":"BreadcrumbList"');
    expect(out).not.toContain('FAQPage');
    const text = strip(out);
    expect(text).toContain('Last verified October 1, 2026');
    expect(text).toContain('Corrections: support@calldesk.tech');
    expect(text).toContain('may have changed them since');
    expect(out).toContain('https://vapi.ai/pricing');
    const meta = metadataFor(page, true);
    expect((meta.alternates as { canonical: string }).canonical).toBe('https://calldesk.tech/compare/calldesk-vs-vapi');
    expect(meta.openGraph).toMatchObject({ url: 'https://calldesk.tech/compare/calldesk-vs-vapi', title: page.title });
    expect(out).toContain('<table');
    expect(out).toContain('scope="col"');
  });
  it('the table omits rows where a side is unknown, and says "not stated" for compliance', () => {
    load(lib());
    const vapi = strip(html('compare', 'calldesk-vs-vapi'));
    expect(vapi).not.toContain('Trying it first'); // Vapi freeTrial is empty
    expect(vapi).not.toContain('Phone numbers from the provider'); // providedNumbers is empty
    expect(vapi).toContain('Billed separately or extra'); // whatIsExtra is not empty
    expect(vapi).not.toContain('Listed price per minute'); // that row was removed: a bare per-minute figure invites an unfair comparison
    expect(vapi).toContain('Bring your own carrier');
    const retell = strip(html('compare', 'calldesk-vs-retell-ai'));
    expect(retell).not.toContain('Billed separately or extra'); // whatIsExtra is empty
    expect(retell).not.toContain('Bring your own carrier'); // unknown
    expect(retell).toContain('Trying it first');
    expect(retell).toMatch(/HIPAA \| ?Not claimed|HIPAA Not claimed/);
    expect(retell).toContain('Not stated on the pages we reviewed');
    expect(retell).toContain('Phone numbers from the provider');
  });
  it('an industry page has plain FAQPage markup and BreadcrumbList, and its FAQ is visible', () => {
    load(lib());
    const out = html('industry', 'dental-offices');
    expect(out).toContain('"@type":"FAQPage"');
    expect(out).toContain('"@type":"BreadcrumbList"');
    const text = strip(out);
    for (const q of fixtureLibrary().industries[0].faq) expect(text).toContain(q.q);
    expect(text).toContain('does not currently claim any compliance certification');
  });
  it('the alternatives page lists Calldesk transparently with the other options from the dataset', () => {
    load(lib());
    const text = strip(html('alternatives', 'vapi-alternatives'));
    expect(text).toContain('We make Calldesk');
    expect(text).toContain('Retell AI');
    expect(text).toContain('Calldesk');
    expect(text).toContain('listed alphabetically');
  });
  it('JSON-LD cannot be broken out of its script tag', () => {
    const l = lib();
    l.industries[0].faq[0].a = 'Close it </script><script>alert(1)</script>';
    load(l);
    expect(html('industry', 'dental-offices')).not.toContain('</script><script>alert');
  });
});

describe('migration pages', () => {
  it('only competitors with steps get one, in priority order, capped at 12', () => {
    const l = clone(fixtureLibrary());
    const base = l.competitors.find((c) => c.slug === 'vapi')!;
    l.competitors = [];
    const slugs = [...MIGRATE_PRIORITY.slice().reverse(), 'zeta-voice', 'alpha-voice', 'no-steps'];
    for (const s of slugs) { const c = clone(base); c.slug = s; c.name = s; if (s === 'no-steps') c.migration.stepsToLeave = []; l.competitors.push(c); }
    const got = migrationCompetitors(l).map((c) => c.slug);
    expect(got).toEqual(MIGRATE_PRIORITY);
    expect(got.length).toBe(MIGRATE_CAP);
    l.competitors = l.competitors.filter((c) => !['vapi', 'retell-ai'].includes(c.slug));
    const got2 = migrationCompetitors(l).map((c) => c.slug);
    expect(got2.slice(0, 10)).toEqual(MIGRATE_PRIORITY.filter((s) => !['vapi', 'retell-ai'].includes(s)));
    expect(got2.slice(10)).toEqual(['alpha-voice', 'zeta-voice']);
    expect(got2).not.toContain('no-steps');
  });
});

void NOW;
