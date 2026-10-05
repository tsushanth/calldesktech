import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Hero } from '@/components/landing/Hero';
import { LITE_CENTS, QUALIFIER, CARRIER_NOTE_LINE, HEADLINE, centsLabel, SITE_TITLE, SITE_DESCRIPTION, HERO_PRICE_LINE, HERO_PRICE_QUALIFIER } from '@/lib/pricingCopy';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
const lite = centsLabel(LITE_CENTS);

describe('hero and site metadata advertise the lowest price from the copy source', () => {
  it('the hero shows the from-price line, the qualifier and the carrier note, with a pricing link', () => {
    const html = renderToStaticMarkup(createElement(Hero));
    const text = strip(html);
    expect(HERO_PRICE_LINE).toContain(`From ${lite} a minute`);
    expect(text).toContain(HERO_PRICE_LINE);
    expect(text).toContain(QUALIFIER);
    expect(text).toContain(CARRIER_NOTE_LINE);
    expect(html).toMatch(/href="\/pricing"/);
    // No unverified claim.
    expect(text).not.toMatch(/setup fee/i);
  });
  it('the hero qualifier is the shared qualifier', () => {
    expect(HERO_PRICE_QUALIFIER).toContain(QUALIFIER);
  });
  it('title and description lead with the product and include the price and the tier prices', () => {
    expect(SITE_TITLE).toBe(`CallDeskTech: AI phone agents from ${lite} a minute`);
    expect(SITE_DESCRIPTION).toContain(`From ${lite} a minute`);
    expect(SITE_DESCRIPTION).toMatch(/answer.*book.*messages.*transfer/);
    expect(SITE_DESCRIPTION).toMatch(/Phone numbers extra/);
    expect(SITE_DESCRIPTION.length).toBeLessThan(160);
    expect(SITE_DESCRIPTION).toMatch(/Standard/);
    expect(SITE_DESCRIPTION).toMatch(/Pro/);
  });
  it('layout and home page metadata, OpenGraph and Twitter all use the shared constants', () => {
    for (const f of ['src/app/layout.tsx', 'src/app/page.tsx']) {
      const src = read(f);
      expect(src).toContain("from '@/lib/pricingCopy'".replace(/'/g, f.endsWith('page.tsx') ? '"' : "'"));
      expect(src).toMatch(/title: SITE_TITLE,\s*\n\s*description: SITE_DESCRIPTION/);
      expect(src).toMatch(/openGraph: \{ title: SITE_TITLE, description: SITE_DESCRIPTION/);
      expect(src).toMatch(/twitter: \{[^}]*title: SITE_TITLE, description: SITE_DESCRIPTION/);
    }
  });
  it('no hand-typed price in the hero or layout sources', () => {
    for (const f of ['src/components/landing/Hero.tsx', 'src/app/layout.tsx']) {
      expect(read(f)).not.toMatch(/\d\s?¢|\d cents/);
    }
    expect(HEADLINE).toContain(`${LITE_CENTS} cents`);
  });
});
