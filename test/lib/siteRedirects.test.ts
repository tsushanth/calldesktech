import { describe, it, expect } from 'vitest';
import { SITE_REDIRECTS } from '@/lib/siteRedirects';

const bySource = (s: string) => SITE_REDIRECTS.find((r) => r.source === s);

describe('SITE_REDIRECTS', () => {
  it('sends the guessed addresses to real pages', () => {
    expect(bySource('/developers')?.destination).toBe('/docs');
    expect(bySource('/integration')?.destination).toBe('/integrations');
    expect(bySource('/integrations/vapi')?.destination).toBe('/integrations#vapi');
    expect(bySource('/vapi')?.destination).toBe('/integrations#vapi');
  });
  it('is temporary, so a later real page is not shadowed by a cached 308', () => {
    expect(SITE_REDIRECTS.every((r) => r.permanent === false)).toBe(true);
  });
  it('has no redirect that points at itself or at another redirect source', () => {
    const sources = new Set(SITE_REDIRECTS.map((r) => r.source));
    for (const r of SITE_REDIRECTS) {
      expect(r.destination.split('#')[0]).not.toBe(r.source);
      expect(sources.has(r.destination.split('#')[0])).toBe(false);
    }
  });
  it('only redirects openapi.json when something is appended, never the file itself', () => {
    const r = bySource('/api/v1/openapi.json:trail(.+)');
    expect(r).toBeDefined();
    expect(r?.destination).toBe('/api/v1/openapi.json');
    expect(r?.source).toContain('(.+)'); // one or more characters required
  });
});
