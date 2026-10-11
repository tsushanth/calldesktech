import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureLibrary, clone, NOW } from './helpers';
import { loadLibrary, DEFAULT_CONTENT_DIR, type Library } from '@/lib/seoLibrary/load';
import { buildPages } from '@/lib/seoLibrary/pages';
import { validatePage } from '@/lib/seoLibrary/validate';
import { categoryOf, relatedOptions, type Category } from '@/lib/seoLibrary/alternatives';
import { similarityReport, SIMILARITY } from '@/lib/seoLibrary/similarity';
import { textOfPage } from '@/lib/seoLibrary/text';
import type { LibraryPageModel } from '@/lib/seoLibrary/model';

// The alternatives page builder (src/lib/seoLibrary/alternatives.ts). Synthetic competitors with clean wording, one per category,
// check structure and wording without depending on the real research files (which another change is still correcting); the real
// files are checked for uniqueness and sourcing only, which is what this builder controls.

const CATEGORIES: Category[] = ['platform', 'no-code-builder', 'answering-service', 'cpaas', 'enterprise', 'model-vendor'];

function syntheticLibrary(): Library {
  const lib = clone(fixtureLibrary());
  const base = lib.competitors.find((c) => c.slug === 'vapi')!;
  lib.competitors = CATEGORIES.map((cat, i) => {
    const c = clone(base);
    c.slug = `sample-${cat}`;
    c.name = `Sample ${i} ${cat}`.replace(/\d/, ['One', 'Two', 'Three', 'Four', 'Five', 'Six'][i]);
    c.category = cat;
    c.url = `https://sample-${cat}.example.com`;
    c.integrations = [...c.integrations, `Tool for ${cat}`];
    c.pricing.model = cat === 'enterprise' ? 'Custom contracts through the sales team' : cat === 'answering-service' ? 'Monthly plans per location' : base.pricing.model;
    if (cat === 'enterprise') c.pricing.perMinuteUsd = null;
    return c;
  });
  lib.publish = { published: [] };
  return lib;
}

const pagesOf = (lib: Library) => buildPages(lib).filter((p) => p.type === 'alternatives');
const headings = (p: LibraryPageModel) => p.blocks.filter((b) => b.kind === 'h2').map((b) => (b.kind === 'h2' ? b.text : ''));

describe('alternatives pages built from synthetic competitors, one per category', () => {
  const lib = syntheticLibrary();
  const pages = pagesOf(lib);

  it('builds one page per competitor and each passes the single-page checks', () => {
    expect(pages).toHaveLength(CATEGORIES.length);
    for (const p of pages) {
      const issues = validatePage(lib, p).filter((i) => i.severity === 'error');
      expect(issues.map((i) => `${i.code}: ${i.message}`), p.path).toEqual([]);
    }
  });

  it('every page has the core sections', () => {
    for (const p of pages) {
      const h = headings(p).join(' | ');
      const name = p.competitorName!;
      for (const need of [`What ${name} does well`, `How ${name} prices`, `Compliance as stated by ${name}`, `What to check before choosing an alternative to ${name}`, 'Where Calldesk fits and where it may not', `Other options to consider besides ${name}`, `What we read about ${name}`]) {
        expect(h, `${p.path} lacks "${need}"`).toContain(need);
      }
    }
  });

  it('the section set and order depend on the category', () => {
    const order = new Set(pages.map((p) => headings(p).map((h) => h.replace(p.competitorName!, 'X')).join('>')));
    expect(order.size).toBeGreaterThanOrEqual(4);
    const answering = pages.find((p) => p.slug === 'sample-answering-service')!;
    const enterprise = pages.find((p) => p.slug === 'sample-enterprise')!;
    expect(headings(answering).join('|')).toContain('What kind of service');
    expect(headings(enterprise).join('|')).toContain('Deployment, integrations and telephony');
    expect(headings(enterprise).join('|')).toContain('Conditions to check');
    // category-specific explanatory text
    expect(textOfPage(answering)).toMatch(/location, a call or a block of receptionist minutes/);
    expect(textOfPage(enterprise)).toMatch(/sales conversation rather than a price list/);
    expect(textOfPage(pages.find((p) => p.slug === 'sample-cpaas')!)).toMatch(/other lines of the bill/);
  });

  it('the checklist has six to nine numbered questions', () => {
    for (const p of pages) {
      const list = p.blocks.find((b) => b.kind === 'list' && b.ordered);
      expect(list && list.kind === 'list' ? list.items.length : 0, p.path).toBeGreaterThanOrEqual(6);
      expect(list && list.kind === 'list' ? list.items.length : 0, p.path).toBeLessThanOrEqual(9);
    }
  });

  it('competitor facts carry a source link', () => {
    for (const p of pages) {
      const c = lib.competitors.find((x) => x.slug === p.slug)!;
      const items = p.blocks.flatMap((b) => (b.kind === 'list' ? b.items : []));
      for (const s of c.strengths) expect(items.find((i) => i.text === s.claim)?.sourceUrl, `strength on ${p.path}`).toBe(s.sourceUrl);
      for (const s of c.limitations) expect(items.find((i) => i.text === s.claim)?.sourceUrl, `limitation on ${p.path}`).toBe(s.sourceUrl);
      for (const n of c.pricing.planNotes) expect(items.find((i) => i.text === n)?.sourceUrl, `plan note on ${p.path}`).toBe(c.pricing.sourceUrls[0]);
    }
  });

  it('states no certification for Calldesk and does not rank', () => {
    for (const p of pages) {
      const t = textOfPage(p);
      expect(t).toContain('claims no certification');
      expect(t).toContain('listed alphabetically');
      expect(t).not.toMatch(/\b(best|cheapest|leading|only)\b/i);
    }
  });
});

describe('related options', () => {
  const lib = syntheticLibrary();
  it('are three per competitor, never itself, and not the same three on every page', () => {
    const sets = lib.competitors.map((c) => relatedOptions(lib, c).map((r) => r.competitor.slug));
    for (const [i, s] of sets.entries()) {
      expect(s).toHaveLength(3);
      expect(s).not.toContain(lib.competitors[i].slug);
    }
    expect(new Set(sets.map((s) => [...s].sort().join(','))).size).toBeGreaterThan(1);
  });
  it('explain the relevance from the two vendors\' own data', () => {
    const c = lib.competitors[0];
    for (const r of relatedOptions(lib, c)) {
      expect(r.why).toContain(c.name);
      expect(r.why).toContain(r.competitor.name);
    }
  });
  it('categoryOf falls back to platform for an unknown category', () => {
    const c = clone(lib.competitors[0]);
    c.category = 'something-new';
    expect(categoryOf(c)).toBe('platform');
  });
});

describe('alternatives pages built from the real competitor files', () => {
  const real = loadLibrary(DEFAULT_CONTENT_DIR);
  const pages = pagesOf(real);
  it('keep every page above the uniqueness floor with headroom, and every pair well under the overlap limit', () => {
    if (pages.length < 2) return;
    const rep = similarityReport(pages.map((p) => ({ id: p.path, text: textOfPage(p, { skip: ['sources'] }) })));
    expect(rep.minUnique).toBeGreaterThan(SIMILARITY.minUniqueShare + 0.05);
    expect(rep.maxJaccard).toBeLessThan(SIMILARITY.maxPairJaccard - 0.1);
  });
  it('quote no dollar amount that is not in that competitor\'s own file', () => {
    for (const p of pages) {
      const c = real.competitors.find((x) => x.slug === p.slug)!;
      const own = JSON.stringify(c);
      const amounts = textOfPage(p, { skip: ['sources'] }).match(/\$\d[\d,]*(?:\.\d+)?/g) ?? [];
      for (const a of amounts) expect(own, `${a} on ${p.path}`).toContain(a);
    }
  });
  it('offer a checklist of six to nine questions that differs from page to page', () => {
    const lists = pages.map((p) => { const b = p.blocks.find((x) => x.kind === 'list' && x.ordered); return b && b.kind === 'list' ? b.items.map((i) => i.text) : []; });
    for (const l of lists) { expect(l.length).toBeGreaterThanOrEqual(6); expect(l.length).toBeLessThanOrEqual(9); }
    expect(new Set(lists.map((l) => l.join('\n'))).size).toBe(lists.length);
  });
  it('link every related option to a competitor that exists in the dataset', () => {
    for (const p of pages) {
      const c = real.competitors.find((x) => x.slug === p.slug)!;
      for (const r of relatedOptions(real, c)) expect(real.competitors.some((x) => x.slug === r.competitor.slug && x.status === 'active')).toBe(true);
    }
  });
});

describe('alternatives.ts follows the same no-typed-facts rule as pages.ts', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/seoLibrary/alternatives.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const lits = src.match(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g) ?? [];
  it('has no digit in the text of a string (a price, count or version typed by hand)', () => {
    // Allowed: the compliance name SOC 2, the block kinds 'h2'/'h3', and internal ids such as 'limit0'.
    const withDigits = lits.filter((l) => /\d/.test(l.replace(/\$\{[^}]*\}/g, '').replace(/\$\{[\s\S]*$/, '').replace(/'(h[23]|soc2|limit\d|unknown\d|cat\d)'/g, '').replace(/SOC 2/g, '')));
    expect(withDigits).toEqual([]);
  });
  it('does not type a plan name or a money amount', () => {
    expect(lits.filter((l) => /\b(Lite|Standard|Pro)\b/.test(l))).toEqual([]);
    expect(src).not.toMatch(/\$\s?\d|\d\s?¢/);
  });
  void NOW;
});
