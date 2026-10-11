/* eslint-disable @typescript-eslint/no-explicit-any -- tests delete and corrupt fields on purpose */
import { describe, it, expect } from 'vitest';
import { fixtureLibrary, clone, NOW } from './helpers';
import { validateLibrary, validateCompetitor, validatePage, type Issue } from '@/lib/seoLibrary/validate';
import { CompetitorSchema, IndustrySchema, UseCaseSchema } from '@/lib/seoLibrary/schema';
import { findBanned, BANNED_STRICT } from '@/lib/seoLibrary/banned';
import { findCertClaims } from '@/lib/seoLibrary/certs';
import { jaccard, shingles } from '@/lib/seoLibrary/similarity';
import type { Library } from '@/lib/seoLibrary/load';

const run = (lib: Library): Issue[] => validateLibrary(lib, NOW, { checkRelated: false }).errors;
const codes = (issues: Issue[]) => issues.map((i) => i.code);
const withVapi = (edit: (v: Library['competitors'][number]) => void): Library => {
  const lib = clone(fixtureLibrary());
  edit(lib.competitors.find((c) => c.slug === 'vapi')!);
  return lib;
};

describe('schema: required fields', () => {
  const vapi = () => clone(fixtureLibrary().competitors.find((c) => c.slug === 'vapi')!);
  it('rejects a strength without a sourceUrl', () => {
    const v = vapi() as any;
    delete v.strengths[0].sourceUrl;
    expect(CompetitorSchema.safeParse(v).success).toBe(false);
  });
  it('rejects a competitor without retrievedAt or with a malformed date', () => {
    const a = vapi() as any; delete a.retrievedAt;
    expect(CompetitorSchema.safeParse(a).success).toBe(false);
    const b = vapi() as any; b.retrievedAt = '10/01/2026';
    expect(CompetitorSchema.safeParse(b).success).toBe(false);
    const c = vapi() as any; c.sources[0].retrievedAt = '';
    expect(CompetitorSchema.safeParse(c).success).toBe(false);
  });
  it('rejects missing compliance and telephony source urls', () => {
    const a = vapi() as any; delete a.compliance.sourceUrl;
    expect(CompetitorSchema.safeParse(a).success).toBe(false);
    const b = vapi() as any; delete b.telephony.sourceUrl;
    expect(CompetitorSchema.safeParse(b).success).toBe(false);
  });
  it('rejects an unknown status, a bad slug, and compliance values other than stated/not-stated', () => {
    const a = vapi() as any; a.status = 'maybe';
    expect(CompetitorSchema.safeParse(a).success).toBe(false);
    const b = vapi() as any; b.slug = 'Vapi AI';
    expect(CompetitorSchema.safeParse(b).success).toBe(false);
    const c = vapi() as any; c.compliance.hipaa = 'yes';
    expect(CompetitorSchema.safeParse(c).success).toBe(false);
  });
  it('requires an industry to have 6 call types, 5 setup steps, 5 FAQs and 4 related slugs', () => {
    const base = clone(fixtureLibrary().industries[0]) as any;
    for (const [k, v] of [['callTypes', base.callTypes.slice(1)], ['setupSteps', base.setupSteps.slice(1)], ['faq', base.faq.slice(1)], ['relatedSlugs', base.relatedSlugs.slice(1)]] as const) {
      expect(IndustrySchema.safeParse({ ...base, [k]: v }).success, k).toBe(false);
    }
    expect(IndustrySchema.safeParse(base).success).toBe(true);
  });
  it('a use case needs steps', () => {
    const uc = clone(fixtureLibrary().useCases[0]) as any;
    expect(UseCaseSchema.safeParse({ ...uc, steps: [] }).success).toBe(false);
  });
});

describe('validator: sources and dates', () => {
  it('flags a fact whose sourceUrl is not in sources[] (so it has no retrievedAt)', () => {
    const lib = withVapi((v) => { v.strengths[0].sourceUrl = 'https://example.com/unlisted'; });
    expect(codes(run(lib))).toContain('FACT_SOURCE_NOT_LISTED');
  });
  it('flags pricing without sourceUrls and migration steps without sources', () => {
    const lib = withVapi((v) => { v.pricing.sourceUrls = []; v.migration.sourceUrls = []; });
    expect(codes(run(lib))).toEqual(expect.arrayContaining(['FACT_NO_SOURCE']));
  });
  it('does not require a compliance sourceUrl when hipaa, soc2 and gdpr are all not-stated', () => {
    const lib = withVapi((v) => { v.compliance.hipaa = 'not-stated'; v.compliance.soc2 = 'not-stated'; v.compliance.gdpr = 'not-stated'; v.compliance.sourceUrl = undefined as any; });
    expect(run(lib).filter((i) => i.message.startsWith('compliance'))).toEqual([]);
  });
  it('still requires a compliance sourceUrl when any of the three is stated', () => {
    const lib = withVapi((v) => { v.compliance.hipaa = 'not-stated'; v.compliance.soc2 = 'stated'; v.compliance.gdpr = 'not-stated'; v.compliance.sourceUrl = undefined as any; });
    expect(run(lib).map((i) => i.code + ':' + i.message)).toContain('FACT_NO_SOURCE:compliance has no sourceUrl');
  });
  it('flags a retrievedAt in the future and warns on a stale one', () => {
    expect(codes(validateCompetitor({ ...clone(fixtureLibrary().competitors[1]), retrievedAt: '2027-01-01' }, NOW))).toContain('DATE_FUTURE');
    const stale = validateCompetitor({ ...clone(fixtureLibrary().competitors[1]), retrievedAt: '2026-01-01' }, NOW);
    expect(stale.find((i) => i.code === 'STALE')?.severity).toBe('warning');
  });
});

describe('validator: duplicate titles and descriptions', () => {
  it('fails when two competitors would produce the same page titles', () => {
    const lib = clone(fixtureLibrary());
    const twin = clone(lib.competitors[0]);
    twin.slug = 'vapi-twin'; // same name, so the same title and description
    twin.name = lib.competitors[1].name;
    lib.competitors.push(twin);
    expect(codes(run(lib))).toEqual(expect.arrayContaining(['DUPLICATE_TITLE']));
  });
  it('fails when two industries share a h1 and metaDescription', () => {
    const lib = clone(fixtureLibrary());
    lib.industries[1].h1 = lib.industries[0].h1;
    lib.industries[1].metaDescription = lib.industries[0].metaDescription;
    const c = codes(run(lib));
    expect(c).toContain('DUPLICATE_TITLE');
    expect(c).toContain('DUPLICATE_DESCRIPTION');
  });
});

describe('validator: similarity', () => {
  it('fails two near-identical industry pages', () => {
    const lib = clone(fixtureLibrary());
    const copy = clone(lib.industries[0]);
    copy.slug = 'dental-copy'; copy.name = 'Dental copy'; copy.h1 = 'AI phone agent for dental copy offices'; copy.metaDescription = `${copy.metaDescription} Copy.`;
    lib.industries.push(copy);
    const c = codes(run(lib));
    expect(c).toContain('TOO_SIMILAR');
    expect(c).toContain('LOW_UNIQUE_SHARE');
  });
  it('jaccard is 1 for identical text and 0 for disjoint text', () => {
    const a = shingles('one two three four five six seven eight');
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingles('alpha beta gamma delta epsilon zeta eta theta'))).toBe(0);
  });
});

describe('validator: banned wording on competitor pages', () => {
  for (const [word, claim] of [
    ['best', 'The best voice platform for developers.'],
    ['only', 'The only platform with a flow builder.'],
    ['worst', 'Has the worst documentation we have seen.'],
    ['unbeatable', 'Unbeatable pricing for large teams.'],
    ['guaranteed', 'Guaranteed uptime on every plan.'],
    ['terrible', 'Terrible support during our review.'],
  ] as const) {
    it(`fails "${word}" in a competitor strength`, () => {
      const lib = withVapi((v) => { v.strengths[0].claim = claim; });
      const errs = run(lib).filter((i) => i.code === 'BANNED_WORD');
      expect(errs.length, word).toBeGreaterThan(0);
      expect(errs.some((e) => e.message.toLowerCase().includes(word))).toBe(true);
    });
  }
  it('whole-word matching: "bestow" and "alwaysville" do not trip, and a company name is allowed', () => {
    expect(findBanned('They bestow credit.', BANNED_STRICT)).toEqual([]);
    expect(findBanned('Best Buy Voice supports transfers.', BANNED_STRICT, ['Best Buy Voice'])).toEqual([]);
    expect(findBanned('The best plan', BANNED_STRICT).length).toBe(1);
  });
  it('lets "English only" through, because it is a stated fact about a voice', () => {
    expect(findBanned('the voice speaks English only', BANNED_STRICT)).toEqual([]);
  });
});

describe('banned wording: product-name exemption', () => {
  it('lets the product name Perfect Venue through but still flags the adjective', () => {
    expect(findBanned('Integrates with Tripleseat and Perfect Venue.', BANNED_STRICT)).toEqual([]);
    expect(findBanned('A perfect fit for venues.', BANNED_STRICT).map((h) => h.term)).toContain('perfect');
  });
});

describe('validator: certification claims', () => {
  it('flags an industry page that says Calldesk is HIPAA compliant', () => {
    const lib = clone(fixtureLibrary());
    lib.industries[0].considerations.push('Calldesk is HIPAA compliant, so you can record calls.');
    expect(codes(run(lib))).toContain('CERT_CLAIM');
  });
  it('flags "we are SOC 2 certified" and "SOC 2 Type II compliant"', () => {
    expect(findCertClaims('We are SOC 2 certified.').length).toBe(1);
    expect(findCertClaims('Our platform is SOC 2 Type II compliant.').length).toBe(1);
    expect(findCertClaims('The service supports HIPAA.').length).toBe(1);
  });
  it('does not read the country abbreviation US as the pronoun us', () => {
    const s = 'Regional data residency (US, EU, India) and HIPAA-eligible with BAAs.';
    expect(findCertClaims(s).length).toBe(1);
    expect(findCertClaims(s)[0].calldeskSubject).toBe(false);
    expect(findCertClaims('Thanks to us, the platform is HIPAA compliant.')[0].calldeskSubject).toBe(true);
    expect(findCertClaims('We are HIPAA compliant.')[0].calldeskSubject).toBe(true);
  });
  it('lets negations and requirement language through', () => {
    expect(findCertClaims('Calldesk does not currently claim HIPAA compliance.')).toEqual([]);
    expect(findCertClaims('Your practice may need to be HIPAA compliant.')).toEqual([]);
    expect(findCertClaims('Ask whether the vendor is SOC 2 certified.')).toEqual([]);
    expect(findCertClaims('The pages did not mention HIPAA, SOC 2 or GDPR.')).toEqual([]);
  });
  it("flags a competitor described as certified when its data says 'not-stated'", () => {
    const lib = clone(fixtureLibrary());
    const retell = lib.competitors.find((c) => c.slug === 'retell-ai')!;
    retell.strengths.push({ claim: 'Retell AI is SOC 2 Type II certified.', sourceUrl: retell.sources[0].url });
    expect(codes(run(lib))).toContain('CERT_CLAIM_COMPETITOR');
  });
  it("allows the same wording when the competitor's data says 'stated'", () => {
    const lib = clone(fixtureLibrary());
    const vapi = lib.competitors.find((c) => c.slug === 'vapi')!;
    vapi.strengths.push({ claim: 'Vapi is SOC 2 Type II certified, according to its trust center.', sourceUrl: vapi.sources[0].url });
    expect(codes(run(lib))).not.toContain('CERT_CLAIM_COMPETITOR');
  });
  it('flags a certification claim about Calldesk on a competitor page', () => {
    const lib = withVapi((v) => { v.strengths.push({ claim: 'Compared with Calldesk, which is HIPAA compliant, this tool needs an add-on.', sourceUrl: v.sources[0].url }); });
    expect(codes(run(lib))).toContain('CERT_CLAIM');
  });
});

describe('validator: competitor page structure', () => {
  const result = validateLibrary(fixtureLibrary(), NOW, { checkRelated: false });
  const compPages = result.pages.filter((p) => ['compare', 'alternatives', 'migrate'].includes(p.type));
  it('every competitor page has a last-verified date, the corrections address, the disclaimer and sources', () => {
    for (const p of compPages) {
      const text = JSON.stringify(p.blocks);
      expect(p.lastVerified, p.path).toBeTruthy();
      expect(text, p.path).toContain('support@calldesk.tech');
      expect(text, p.path).toMatch(/may have changed them since/);
      expect(p.blocks.some((b) => b.kind === 'sources' && b.items.length > 0), p.path).toBe(true);
    }
  });
  it('no competitor page carries FAQ markup', () => {
    for (const p of compPages) {
      expect(p.faqJsonLd, p.path).toBeUndefined();
      expect(p.blocks.some((b) => b.kind === 'faq'), p.path).toBe(false);
    }
  });
});

describe('validator: other rules', () => {
  it('flags a short intro and a related slug that does not exist (when related checking is on)', () => {
    const lib = clone(fixtureLibrary());
    lib.industries[0].intro = 'Too short.';
    const all = validateLibrary(lib, NOW, { checkRelated: true }).errors.map((i) => i.code);
    expect(all).toContain('INTRO_SHORT');
    expect(all).toContain('RELATED_MISSING');
  });
  it('flags a publish.json entry that matches no page and a published page that has errors', () => {
    const lib = clone(fixtureLibrary());
    lib.publish.published = ['not-a-page'];
    expect(codes(run(lib))).toContain('PUBLISH_UNKNOWN');
    const lib2 = clone(fixtureLibrary());
    lib2.industries[0].considerations.push('Calldesk is HIPAA compliant.');
    lib2.publish.published = ['dental-offices'];
    expect(codes(run(lib2))).toContain('PUBLISHED_PAGE_HAS_ERRORS');
  });
  it('a thin page fails', () => {
    const lib = clone(fixtureLibrary());
    const vapi = lib.competitors.find((c) => c.slug === 'vapi')!;
    vapi.migration.stepsToLeave = ['Cancel.'];
    vapi.strengths = []; vapi.limitations = []; vapi.unknowns = []; vapi.pricing.planNotes = []; vapi.integrations = []; vapi.positioning = 'A tool.'; vapi.bestFor = '';
    vapi.pricing.whatIsExtra = []; vapi.pricing.freeTrial = ''; vapi.pricing.headline = ''; vapi.pricing.model = 'Usage.'; vapi.telephony.providedNumbers = '';
    // Template wording alone still clears the word minimum, so the unique-share rule is what catches a page with no data behind it.
    expect(codes(run(lib))).toContain('LOW_UNIQUE_SHARE');
  });
  it('a page under its word minimum fails THIN_PAGE', () => {
    const lib = fixtureLibrary();
    const page = { ...validateLibrary(lib, NOW, { checkRelated: false }).pages[0], blocks: [{ kind: 'p' as const, text: 'Too short.' }] };
    expect(validatePage(lib, page).map((i) => i.code)).toContain('THIN_PAGE');
  });
  it('a page with an empty title or description fails MISSING_FIELD', () => {
    const lib = fixtureLibrary();
    const page = { ...validateLibrary(lib, NOW, { checkRelated: false }).pages[0], title: '', description: ' ' };
    expect(validatePage(lib, page).filter((i) => i.code === 'MISSING_FIELD').length).toBe(2);
  });
  it('only active competitors get pages; unclear and inactive are skipped', () => {
    const lib = clone(fixtureLibrary());
    lib.competitors[0].status = 'inactive';
    const pages = validateLibrary(lib, NOW, { checkRelated: false }).pages;
    expect(pages.filter((p) => p.competitorSlug === lib.competitors[0].slug)).toEqual([]);
  });
});
