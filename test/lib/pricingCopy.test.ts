import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PRICING_TIERS } from '@/lib/pricingTiers';
import { HEADLINE, QUALIFIER, HEADLINE_WITH_QUALIFIER, US_RATE_LONG, LIVE_RANGE, twoMinuteCallRange, pricingPlainText, workedExample, STANDARD_CENTS, PHONE_NUMBER_OPTIONS, PHONE_NUMBERS_LINE } from '@/lib/pricingCopy';
import { NUMBER_ADDON_PRICES } from '@/lib/numberAddOn';
import { COMPETITORS } from '@/lib/compareData';
import { THUNDERPHONE_PRICING } from '@/lib/competitorPricing';
import { PricingComparison } from '@/components/compare/PricingComparison';
import { DECK_SLIDES } from '@/lib/deck/slides';
import { buildInvestorSlides } from '@/lib/deck/investorSlides';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('pricing copy is derived from the tiers', () => {
  it('headline always appears with the qualifier that says what can be bought now', () => {
    expect(HEADLINE).toBe('Phone agents from 2 cents a minute');
    expect(QUALIFIER).toBe('Lite 2 cents, Standard 5 cents and Pro 9 cents per minute, all available now');
    expect(HEADLINE_WITH_QUALIFIER).toContain(QUALIFIER);
  });
  it('matches the tier catalog', () => {
    const c = (id: string) => PRICING_TIERS.find((t) => t.id === id)!.pricePerMinuteCents;
    expect([c('lite'), c('standard'), c('pro')]).toEqual([2, 5, 9]);
    expect(LIVE_RANGE).toBe('2¢ to 9¢');
    expect(twoMinuteCallRange()).toBe('$0.04 to $0.18');
    expect(US_RATE_LONG).toContain('5¢/min Standard');
    expect(US_RATE_LONG).toContain('9¢/min Pro');
    expect(US_RATE_LONG).not.toMatch(/numbers included/);
    expect(US_RATE_LONG).toContain('2¢/min Lite');
    expect(US_RATE_LONG).not.toMatch(/coming soon/i);
  });
  it('states no amounts for the coming-soon add-ons (phone numbers are the one live priced extra)', () => {
    const add = pricingPlainText().split('\n').filter((l) => /add-ons/i.test(l)).join(' ');
    expect(add).toMatch(/coming soon/);
    expect(add).not.toMatch(/\$\d|\d\s?(cents|c\b)/);
  });
  it('the worked example is computed from the config constants, so it cannot drift', () => {
    const w = workedExample();
    expect(w.text).toBe('Standard with one Telnyx number and 500 inbound minutes a month: 500 x 5c + $1.00 + 500 x 1c = $31.00');
    expect(w.totalCents).toBe(500 * STANDARD_CENTS + NUMBER_ADDON_PRICES.telnyx.monthlyCents + 500 * NUMBER_ADDON_PRICES.telnyx.inboundCentsPerMinute);
    const t = workedExample({ tier: 'pro', carrier: 'twilio', inboundMinutes: 100 });
    expect(t.totalCents).toBe(100 * 9 + 200 + 100 * 1.5);
    expect(t.text).toBe('Pro with one Twilio number and 100 inbound minutes a month: 100 x 9c + $2.00 + 100 x 1.5c = $12.50');
  });
  it('lists the two phone-number options from the add-on config, Telnyx first, and bring-your-own as free', () => {
    expect(PHONE_NUMBER_OPTIONS.map((o) => o.carrier)).toEqual(['telnyx', 'twilio']);
    expect(PHONE_NUMBER_OPTIONS[0].line).toBe('Telnyx number: $1.00 per month + 1 cent per inbound minute');
    expect(PHONE_NUMBER_OPTIONS[1].line).toBe('Twilio number: $2.00 per month + 1.5 cents per inbound minute');
    expect(PHONE_NUMBER_OPTIONS[1].note).toMatch(/payments/);
    expect(PHONE_NUMBERS_LINE).toContain('Bring your own number or carrier: free');
  });
});

describe('compare data: no stale flat-price claims about us, and never a bare 2 cents', () => {
  for (const c of COMPETITORS) {
    it(`${c.slug}: our column`, () => {
      const ours = [...c.stats.map((s) => s.us), ...c.rows.filter((r) => r.group === 'Pricing').map((r) => r.us), c.heroHeadline, c.heroSub].join(' | ');
      expect(ours).not.toMatch(/\$0\.10|flat, all-in|\$0\.10\/min flat/);
      // the 2 cent price is only ever shown as the Lite plan's, never as a bare headline rate
      for (const m of ours.matchAll(/.{0,14}(?<![0-9])2¢.{0,14}/g)) expect(m[0]).toMatch(/Lite/);
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
    expect(text).not.toMatch(/Lite[^.]{0,40}coming soon/i);
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
    expect(t).toContain('Phone agents from 2 cents a minute. Lite 2 cents, Standard 5 cents and Pro 9 cents per minute, all available now.');
    expect(t).toContain(pricingPlainText());
    expect(t).not.toMatch(/\$49|\$0\.10/);
  });
  it('the partner payout numbers are untouched', () => {
    const t = read('src/app/partners/page.tsx');
    expect(t).toContain('20% for 12 months');
    // The worked example follows the Pro price (20% of 9 cents), not a typed number.
    expect(t).toContain('PRO_CENTS * PARTNER_SHARE');
  });
});

describe('decks', () => {
  it('customer deck pricing slide states the tiers, not the flat price', () => {
    const t = strip(DECK_SLIDES.find((s) => s.includes('id="pricing"'))!);
    expect(t).toContain('2 to 9 cents a minute');
    expect(t).toContain('Standard is 5 cents');
    expect(t).toContain('Pro is 9 cents');
    expect(t).not.toMatch(/phone numbers included/i);
    expect(t).toContain('Lite is 2 cents with our efficient voice');
    expect(t).not.toContain('$0.10 per minute');
  });
  it('investor deck price slide leads with the tiers and qualifies Lite', () => {
    const t = strip(buildInvestorSlides().join(' '));
    expect(t).toContain('5 cents Standard');
    expect(t).toContain('Lite 2 cents (efficient voice)');
    expect(t).not.toContain('$0.10 default, to $0.16 premium voices');
  });
});
