import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PRICING_TIERS } from '@/lib/pricingTiers';
import { HEADLINE, QUALIFIER, HEADLINE_WITH_QUALIFIER, US_RATE_LONG, LIVE_RANGE, twoMinuteCallRange, pricingPlainText } from '@/lib/pricingCopy';
import { COMPETITORS } from '@/lib/compareData';
import { THUNDERPHONE_PRICING } from '@/lib/competitorPricing';
import { PricingComparison } from '@/components/compare/PricingComparison';
import { DECK_SLIDES } from '@/lib/deck/slides';
import { buildInvestorSlides } from '@/lib/deck/investorSlides';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('pricing copy is derived from the tiers', () => {
  it('headline never appears without the coming-soon qualifier', () => {
    expect(HEADLINE).toBe('Phone agents from 2 cents a minute');
    expect(QUALIFIER).toBe('Lite is coming soon; Standard 6 cents and Pro 10 cents are available now');
    expect(HEADLINE_WITH_QUALIFIER).toContain(QUALIFIER);
  });
  it('matches the tier catalog', () => {
    const c = (id: string) => PRICING_TIERS.find((t) => t.id === id)!.pricePerMinuteCents;
    expect([c('lite'), c('standard'), c('pro')]).toEqual([2, 6, 10]);
    expect(LIVE_RANGE).toBe('6¢ to 10¢');
    expect(twoMinuteCallRange()).toBe('$0.12 to $0.20');
    expect(US_RATE_LONG).toContain('6¢/min (Standard)');
    expect(US_RATE_LONG).toContain('10¢/min with numbers included (Pro)');
    expect(US_RATE_LONG).toMatch(/Lite from 2¢\/min coming soon/);
  });
  it('states no add-on amounts', () => {
    expect(pricingPlainText()).not.toMatch(/\+\s?\d/);
  });
});

describe('compare data: no stale flat-price claims about us, and never a bare 2 cents', () => {
  for (const c of COMPETITORS) {
    it(`${c.slug}: our column`, () => {
      const ours = [...c.stats.map((s) => s.us), ...c.rows.filter((r) => r.group === 'Pricing').map((r) => r.us), c.heroHeadline, c.heroSub].join(' | ');
      expect(ours).not.toMatch(/\$0\.10|flat, all-in|\$0\.10\/min flat/);
      // any mention of the 2 cent Lite price must say it is coming soon
      for (const m of ours.matchAll(/2¢[^|]*/g)) expect(m[0]).toMatch(/coming soon/i);
    });
  }
  it('pricing rows do not carry an "ahead" verdict where the competitor is level or cheaper', () => {
    const v = (slug: string) => COMPETITORS.find((c) => c.slug === slug)!.rows.find((r) => r.group === 'Pricing')!.verdict;
    expect(v('vapi')).toBe('neither');
    expect(v('telnyx')).toBe('gap');
    expect(v('plivo-voice-ai')).toBe('gap');
  });
});

describe('ThunderPhone pricing section renders from competitorPricing.ts', () => {
  const html = renderToStaticMarkup(createElement(PricingComparison, { competitor: THUNDERPHONE_PRICING }));
  const text = strip(html);
  it('has every tier of both vendors with the data-module rates', () => {
    for (const t of THUNDERPHONE_PRICING.tiers) {
      expect(text).toContain(t.name);
      expect(text).toContain(`${t.centsPerMinute}¢`);
    }
    for (const t of PRICING_TIERS) expect(text).toContain(t.name);
    expect(text).toContain('similar structure');
  });
  it('shows source URL and retrieval date from the data module', () => {
    expect(html).toContain(`href="${THUNDERPHONE_PRICING.source}"`);
    expect(text).toContain(THUNDERPHONE_PRICING.retrievedAt);
    expect(THUNDERPHONE_PRICING.retrievedAt).toBe('2026-10-02');
    expect(THUNDERPHONE_PRICING.source).toBe('https://thunderphone.com/pricing');
  });
  it('re-renders from changed data (single source of truth)', () => {
    const changed = { ...THUNDERPHONE_PRICING, retrievedAt: '2027-01-01', tiers: [{ ...THUNDERPHONE_PRICING.tiers[0], centsPerMinute: 3 }] };
    const t2 = strip(renderToStaticMarkup(createElement(PricingComparison, { competitor: changed })));
    expect(t2).toContain('2027-01-01');
    expect(t2).toContain('3¢');
  });
  it('makes no superiority claim and states no our-side add-on amounts', () => {
    expect(text).not.toMatch(/cheaper|better than|beat/i);
    expect(text).toContain('Lite is coming soon');
  });
});

describe('page wiring', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
  it('the thunderphone page uses the shared table and data', () => {
    const src = read('src/app/compare/thunderphone/page.tsx');
    expect(src).toContain('PricingComparison');
    expect(src).toContain('THUNDERPHONE_PRICING');
  });
  it('the home page renders the pricing summary', () => {
    expect(read('src/app/page.tsx')).toContain('<PricingSummary />');
  });
  it('llms.txt states the three tiers with the qualified headline', () => {
    const t = read('public/llms.txt');
    expect(t).toContain('Phone agents from 2 cents a minute. Lite is coming soon; Standard 6 cents and Pro 10 cents are available now.');
    expect(t).not.toMatch(/\$49|\$0\.10/);
  });
  it('the partner payout numbers are untouched', () => {
    const t = read('src/app/partners/page.tsx');
    expect(t).toContain("$0.02 per minute");
    expect(t).toContain('20% for 12 months');
  });
});

describe('decks', () => {
  it('customer deck pricing slide states the tiers, not the flat price', () => {
    const t = strip(DECK_SLIDES.find((s) => s.includes('id="pricing"'))!);
    expect(t).toContain('6 to 10 cents a minute');
    expect(t).toContain('Lite from 2 cents is coming soon');
    expect(t).not.toContain('$0.10 per minute');
  });
  it('investor deck price slide leads with the tiers and qualifies Lite', () => {
    const t = strip(buildInvestorSlides().join(' '));
    expect(t).toContain('6 cents Standard');
    expect(t).toContain('Lite 2 cents coming soon');
    expect(t).not.toContain('$0.10 default, to $0.16 premium voices');
  });
});
