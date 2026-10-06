import { describe, it, expect } from 'vitest';
import { parseVapiPartners } from '@/lib/outreach/discovery/vapiDirectory';

// A tiny payload in the same shape as the page's __NUXT_DATA__: a flat array whose objects point at each other by index.
function page(items: { title: string; website: string; slug: string; headline?: string }[]): string {
  const arr: unknown[] = [['ShallowReactive', 1], { list: 2 }, []];
  const refs: number[] = [];
  for (const it of items) {
    const base = arr.length;
    arr.push({ title: base + 1, website: base + 2, slug: base + 3, headline: base + 4, entryType: base + 5 });
    arr.push(it.title, it.website, it.slug, it.headline ?? '', 'partner');
    refs.push(base);
  }
  arr[2] = refs;
  return `<html><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(arr)}</script></html>`;
}

describe('parseVapiPartners', () => {
  it('reads agencies from the payload', () => {
    const out = parseVapiPartners(page([{ title: 'Acme Voice Agency', website: 'https://www.acmevoice.com/', slug: 'acme', headline: 'We build voice agents' }]));
    expect(out).toEqual([{ slug: 'acme', name: 'Acme Voice Agency', domain: 'acmevoice.com', headline: 'We build voice agents', description: null }]);
  });
  it('drops infrastructure and speech vendors', () => {
    const out = parseVapiPartners(page([
      { title: 'Amazon Web Services', website: 'https://aws.amazon.com/', slug: 'aws' },
      { title: 'Deepgram', website: 'https://deepgram.com', slug: 'deepgram' },
      { title: 'Real Agency', website: 'https://realagency.io', slug: 'real' },
    ]));
    expect(out.map((p) => p.slug)).toEqual(['real']);
  });
  it('de-duplicates by slug and tolerates a page with no payload', () => {
    const p = { title: 'Dup', website: 'https://dup.co', slug: 'dup' };
    expect(parseVapiPartners(page([p, p]))).toHaveLength(1);
    expect(parseVapiPartners('<html></html>')).toEqual([]);
    expect(parseVapiPartners('<script id="__NUXT_DATA__">not json</script>')).toEqual([]);
  });
});
