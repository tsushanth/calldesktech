import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PRICING_TIERS, INCLUDED_ON_ALL } from '@/lib/pricingTiers';
import { NUMBER_ADDON_PRICES } from '@/lib/numberAddOn';
import { EXPERT_BACKUP_CENTS_PER_MINUTE } from '@/lib/expertBackup';
import { CALLDESK_CERTIFICATION_ALLOW_LIST, COMPLIANCE_FACTS, INCLUDED_ON_EVERY_PLAN, LANGUAGES, PHONE_NUMBERS, TIERS, UNVERIFIED, EXPERT_BACKUP_FACT, FEATURE_VOCABULARY } from '@/content/calldeskFacts';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** String and template literals in a TypeScript file, comments removed. */
function literals(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return noComments.match(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g) ?? [];
}

describe('calldeskFacts.ts is derived from the product code', () => {
  it('lists exactly the live tiers, with the prices from pricingTiers.ts', () => {
    expect(TIERS.map((t) => [t.id, t.centsPerMinute])).toEqual(PRICING_TIERS.filter((t) => t.availability === 'live').map((t) => [t.id, t.pricePerMinuteCents]));
    expect(TIERS.length).toBeGreaterThan(0);
  });
  it('includes what the pricing page says is on every plan, unchanged', () => {
    expect(INCLUDED_ON_EVERY_PLAN).toEqual(INCLUDED_ON_ALL);
  });
  it('phone number prices match numberAddOn.ts', () => {
    expect(PHONE_NUMBERS.options).toHaveLength(Object.keys(NUMBER_ADDON_PRICES).length);
    expect(PHONE_NUMBERS.options.map((o) => o.monthly).join(' ')).toContain(`$${(NUMBER_ADDON_PRICES.telnyx.monthlyCents / 100).toFixed(2)}`);
    expect(PHONE_NUMBERS.options.map((o) => o.monthly).join(' ')).toContain(`$${(NUMBER_ADDON_PRICES.twilio.monthlyCents / 100).toFixed(2)}`);
  });
  it('expert backup price comes from expertBackup.ts', () => {
    expect(EXPERT_BACKUP_FACT.price).toContain(String(EXPERT_BACKUP_CENTS_PER_MINUTE));
  });
  it('the language headline stays below the real language count', () => {
    expect(LANGUAGES.totalCount).toBeGreaterThan(LANGUAGES.headlineFloor);
  });
  it('claims no certification: the allow-list is empty and the compliance statement names none', () => {
    expect(CALLDESK_CERTIFICATION_ALLOW_LIST).toEqual([]);
    expect(COMPLIANCE_FACTS.certificationsClaimed).toEqual([]);
    expect(COMPLIANCE_FACTS.statement).not.toMatch(/HIPAA|SOC|GDPR|ISO|PCI/i);
  });
  it('lists what it could not verify, and every feature names the code behind it', () => {
    expect(UNVERIFIED.length).toBeGreaterThan(0);
    for (const f of FEATURE_VOCABULARY) expect(f.backedBy.length).toBeGreaterThan(3);
  });
  it('contains no cost, margin or vendor-rate wording (the repo is public)', () => {
    const src = read('src/content/calldeskFacts.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/margin|vendor rate|our cost|wholesale/i);
  });
});

describe('templates take every Calldesk statement from calldeskFacts.ts', () => {
  const lits = literals(read('src/lib/seoLibrary/pages.ts'));
  it('has no digit in the text of a string in pages.ts (a price, count or version typed by hand; the compliance name SOC 2 is allowed)', () => {
    const withDigits = lits.filter((l) => /\d/.test(l.replace(/\$\{[^}]*\}/g, '').replace(/'(h[23]|soc2)'/g, '').replace(/SOC 2/g, '')));
    expect(withDigits).toEqual([]);
  });
  it('does not type a plan name in a string in pages.ts', () => {
    const names = lits.filter((l) => /\b(Lite|Standard|Pro)\b/.test(l));
    expect(names).toEqual([]);
  });
  it('does not type a money amount or per-minute price anywhere in the library sources', () => {
    for (const f of ['pages.ts', 'validate.ts', 'seo.ts', 'routes.ts']) {
      const src = read(`src/lib/seoLibrary/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(src, f).not.toMatch(/\$\s?\d|\d\s?¢|\d+ cents?\b/);
    }
  });
});
