import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PricingContent } from '@/components/pricing/PricingContent';
import { PRICING_TIERS, ADD_ONS, CARRIER_NOTE, publicPricing } from '@/lib/pricingTiers';
import { ADD_ONS_LINE, HEADLINE, HEADLINE_WITH_QUALIFIER } from '@/lib/pricingCopy';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
const html = renderToStaticMarkup(createElement(PricingContent, { cta: createElement('button', { 'data-testid': 'stub-cta' }, 'Get Started') }));
const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');

describe('/pricing server-rendered content (no session, no JS)', () => {
  it('has the headline, all three tiers and their prices', () => {
    expect(html).toContain('Phone agents from 2¢ a minute.');
    expect(html).toContain('data-testid="pricing-tiers"');
    for (const t of PRICING_TIERS) {
      expect(html).toContain(`id="plan-${t.id}"`);
      expect(text).toContain(t.name);
      expect(html).toContain(`$${(t.pricePerMinuteCents / 100).toFixed(2)}`);
    }
    expect(text).toContain('Lite at 2¢ is coming soon');
  });
  it('has the carrier note, the add-on list and the ThunderPhone line', () => {
    expect(text).toContain(CARRIER_NOTE);
    for (const a of ADD_ONS) expect(text).toContain(a.label);
    expect(text).toContain('ThunderPhone');
    expect(html).toContain('href="/compare/thunderphone"');
  });
  it('says add-ons are coming soon, with no amounts and nothing buyable', () => {
    expect(text).toContain('Optional add-ons, coming soon');
    expect(text).toContain('amounts will be announced when they launch');
    expect(text).not.toMatch(/\+\$\d/);
    expect(text).not.toMatch(/Price to be announced/);
  });
  it('mounts the checkout slot and the calculator', () => {
    expect(html).toContain('data-testid="stub-cta"');
  });
});

describe('/pricing page wiring', () => {
  const page = read('src/app/pricing/page.tsx');
  it('is a server component (no use client) that exports metadata from pricingCopy', () => {
    expect(page).not.toMatch(/['"]use client['"]/);
    expect(page).toContain('export const metadata');
    expect(page).toContain('HEADLINE_WITH_QUALIFIER');
    expect(HEADLINE).toBe('Phone agents from 2 cents a minute');
    expect(HEADLINE_WITH_QUALIFIER).toContain('Lite is coming soon');
  });
  it('the session lives only in the checkout island, which keeps the checkout logic', () => {
    const island = read('src/components/pricing/GetStartedButton.tsx');
    expect(island).toMatch(/^'use client'/);
    expect(island).toContain("fetch('/api/checkout'");
    expect(island).toContain("activeTenantId || localStorage.getItem('calldesk_business_id')");
    expect(read('src/components/pricing/PricingContent.tsx')).not.toMatch(/useSession|use client/);
  });
});

describe('no surface implies add-ons can be bought now', () => {
  const files = ['src/lib/openapi.ts', 'src/lib/mcp/tools.ts', 'src/lib/mcp/toolDocs.ts', 'src/app/docs/page.tsx', 'public/llms.txt', 'src/lib/pricingCopy.ts', 'src/components/compare/PricingComparison.tsx'];
  it('every add-on mention in API/MCP/docs/llms text says coming soon or not purchasable', () => {
    for (const f of files) {
      const src = read(f);
      for (const line of src.split('\n').filter((l) => /add-ons?\b/i.test(l))) {
        if (/^\s*\/\/|^\s*\*/.test(line) || /import /.test(line) || /ADD_ONS_LINE/.test(line)) continue;
        expect(line, f).toMatch(/coming soon|cannot be bought|planned|not purchasable|later|add-ons<|Add-ons: /i);
      }
    }
  });
  it('ADD_ONS_LINE and the public pricing notes say they are not purchasable yet', () => {
    expect(ADD_ONS_LINE).toMatch(/coming soon/);
    expect(ADD_ONS_LINE).toMatch(/cannot be bought yet/);
    expect(publicPricing().notes.join(' ')).toMatch(/cannot be bought yet/);
  });
});
