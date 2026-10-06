import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PricingContent } from '@/components/pricing/PricingContent';
import { PricingSummary } from '@/components/landing/PricingSummary';
import { PRICING_TIERS, INCLUDED_ON_ALL, ADD_ONS, ratingsForStack } from '@/lib/pricingTiers';
import { HIGH_VOLUME, PHONE_NUMBER_OPTIONS, workedExample } from '@/lib/pricingCopy';
import { NUMBER_ADDON_PRICES } from '@/lib/numberAddOn';
import { buildOpenApi } from '@/lib/openapi';
import { GET as pricingRoute } from '@/app/api/pricing/route';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const html = renderToStaticMarkup(createElement(PricingContent, { cta: createElement('button', null, 'Get Started') }));
const text = strip(html);

describe('pricing page structure: engine tiers, one included block, extras', () => {
  it('each tier card shows name, price, engine line, who it is for, and Voice / Response speed / Reasoning rows', () => {
    for (const t of PRICING_TIERS) {
      const r = ratingsForStack(t.stack);
      const card = strip(html.slice(html.indexOf(`id="plan-${t.id}"`), html.indexOf('</section>', html.indexOf(`id="plan-${t.id}"`))));
      expect(card).toContain(t.name);
      expect(card).toContain(`$${(t.pricePerMinuteCents / 100).toFixed(2)}`);
      expect(card).toContain(t.tagline);
      expect(card).toContain(t.whoItsFor);
      expect(card).toMatch(new RegExp(`Voice ${r.voice} Response speed ${r.responseSpeed} Reasoning ${r.reasoning}`));
      expect(card).not.toMatch(/Call summary|Full transcript|phone numbers and calling/i);
    }
    expect(text).toContain('Most popular');
    expect(html.indexOf('Most popular')).toBeGreaterThan(html.indexOf('id="plan-standard"'));
    expect(html.indexOf('Most popular')).toBeLessThan(html.indexOf('id="plan-pro"'));
  });
  it('states the platform features exactly once, in one block', () => {
    expect(html.match(/data-testid="included-on-every-plan"/g)).toHaveLength(1);
    for (const f of INCLUDED_ON_ALL) expect(text.split(strip(f)).length - 1).toBe(1);
    expect(text).toContain('Included on every plan');
  });
  it('Extras: live phone numbers with both priced options and bring-your-own free, plus the worked example', () => {
    const extras = strip(html.slice(html.indexOf('data-testid="pricing-extras"')));
    expect(extras).toContain('Phone numbers');
    expect(extras).toContain('$1.00 per month + 1 cent per inbound minute');
    expect(extras).toContain('$2.00 per month + 1.5 cents per inbound minute');
    expect(extras).toMatch(/Bring your own number or carrier\s*Free/);
    expect(extras).toMatch(/payments and our existing SMS setup/);
    expect(extras).toContain(workedExample().text);
    expect(workedExample().text).toBe('Standard with one Telnyx number and 500 inbound minutes a month: 500 x 5c + $1.00 + 500 x 1c = $31.00');
  });
  it('the other add-ons stay coming soon with no amount', () => {
    for (const a of ADD_ONS) { expect(a.centsPerMinute).toBeNull(); expect(text).toContain(a.label); }
    expect(text).toContain('Optional add-ons, coming soon');
    expect(text).toContain('amounts will be announced when they launch');
  });
  it('the phone-number prices shown are the add-on config values', () => {
    expect(PHONE_NUMBER_OPTIONS.find((o) => o.carrier === 'twilio')!.monthly).toBe(`$${(NUMBER_ADDON_PRICES.twilio.monthlyCents / 100).toFixed(2)} per month`);
    expect(PHONE_NUMBER_OPTIONS.find((o) => o.carrier === 'telnyx')!.inbound).toBe('1 cent per inbound minute');
  });
  it('the home summary shows the rating rows and no old carrier wording', () => {
    const s = strip(renderToStaticMarkup(createElement(PricingSummary)));
    expect(s).toContain('Response speed');
    expect(s).toContain('Phone numbers from us, on any plan');
    expect(s).not.toMatch(/Managed phone numbers|phone numbers and calling included/i);
  });
});

describe('API surfaces', () => {
  it('GET /api/pricing carries the new prices, ratings, the phone number extra and no model names', async () => {
    const body = await (await pricingRoute()).json();
    expect(body.tiers.map((t: { pricePerMinuteCents: number }) => t.pricePerMinuteCents)).toEqual([2, 5, 9]);
    expect(body.tiers.every((t: { carrierMode: string }) => t.carrierMode === 'byo')).toBe(true);
    expect(body.phoneNumbers.tiers).toEqual(['lite', 'standard', 'pro']);
    expect(body.includedOnAllTiers).toEqual(INCLUDED_ON_ALL);
    expect(JSON.stringify(body)).not.toMatch(/llmModel|haiku|sonnet|gemini|eleven|piper|kokoro/i);
  });
  it('OpenAPI says phone numbers are a paid extra on every plan', () => {
    const j = JSON.stringify(buildOpenApi('https://x.test'));
    expect(j).not.toMatch(/Pro includes|phone service included/i);
    expect(j).toMatch(/On every plan this is a paid extra/);
  });
});

// Grep-style guard: no copy surface may bring back the old prices or "Pro includes phone service".
describe('no stale copy anywhere in the repo sources', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(path.join(root, dir))) {
      const rel = `${dir}/${name}`;
      const st = statSync(path.join(root, rel));
      if (st.isDirectory()) { if (name !== 'node_modules' && name !== '.next') walk(rel, out); }
      else if (/\.(ts|tsx|md|txt|mjs|json)$/.test(name)) out.push(rel);
    }
    return out;
  }
  const files = [...walk('src'), ...walk('docs'), ...walk('public'), 'scripts/stripe-create-tier-prices.mjs', 'README.md'].filter((f) => !f.endsWith('.json') || f.includes('public/'));
  // Comment lines may describe legacy history; everything else is copy or code.
  const body = (f: string) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*|#|<!--)/.test(l)).join('\n');
  const banned: Array<[RegExp, string]> = [
    [/phone service (is )?included/i, 'phone service included'],
    [/Pro includes (phone|numbers)/i, 'Pro includes phone'],
    [/includes phone service/i, 'includes phone service'],
    [/phone numbers and calling included|numbers and calling included/i, 'numbers and calling included'],
    [/Pro \(numbers included\)|Pro,? numbers included|Pro, phone numbers included/i, 'Pro numbers included'],
    [/Managed phone numbers/i, 'Managed phone numbers'],
    [/\b(Standard|Pro)\b[^.\n]{0,12}\b(6|10)\s?(¢|cents?)\b/, 'old Standard/Pro price'],
    [/\b(6|10)\s?(¢|cents?)\s*\/?\s*(min|per minute|a minute)?\s*(Standard|Pro)\b/, 'old price before tier'],
  ];
  const skip = new Set(['docs/pricing-tier-migration-notes.md', 'docs/tiered-billing.md']); // these narrate the change and the old prices on purpose
  it('no file in src, public, docs or scripts says phone service is included or states the old prices', () => {
    const hits: string[] = [];
    for (const f of files) {
      if (skip.has(f) || f.includes('/outreach/') || f.includes('design-references')) continue;
      const b = body(f);
      for (const [re, label] of banned) if (re.test(b)) hits.push(`${f}: ${label}`);
    }
    expect(hits).toEqual([]);
  });
  it('the tiers say bring your own carrier and phone numbers are priced for every tier', () => {
    expect(read('src/lib/numberAddOn.ts')).toMatch(/NUMBER_ADDON_TIERS: readonly TierId\[\] = \['lite', 'standard', 'pro'\]/);
  });
});

describe('pricing page: high-volume block is a talk-to-us announcement, not an offer with numbers', () => {
  const block = strip(html.slice(html.indexOf('data-testid="pricing-high-volume"')));
  const copy = [HIGH_VOLUME.heading, HIGH_VOLUME.status, HIGH_VOLUME.intro, ...HIGH_VOLUME.points.flatMap((p) => [p.title, p.body])].join(' ');
  it('sits after Extras and before the checkout button, says coming soon, and links to a mailbox', () => {
    expect(html.indexOf('data-testid="pricing-high-volume"')).toBeGreaterThan(html.indexOf('data-testid="pricing-extras"'));
    expect(html.indexOf('data-testid="pricing-high-volume"')).toBeLessThan(html.indexOf('Get Started'));
    expect(block).toContain('Coming soon, by arrangement');
    expect(block).toContain(HIGH_VOLUME.cta);
    expect(HIGH_VOLUME.ctaHref).toMatch(/^mailto:support@calldesk\.tech/);
  });
  it('states the volume-cost and vendor-price-protection points', () => {
    expect(block).toContain('Cost that falls as your volume grows');
    expect(block).toContain('Protected from model vendor price increases');
  });
  it('carries no amounts, percentages, latency or cost figures (public repo, nothing verified yet)', () => {
    expect(copy).not.toMatch(/[0-9$%¢]/);
    expect(copy).not.toMatch(/\b(margin|cost us|our cost|ms|millisecond|faster than|cheaper than|save[sd]?)\b/i);
  });
});
