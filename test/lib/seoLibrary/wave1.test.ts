import { describe, it, expect } from 'vitest';
import { loadLibrary, DEFAULT_CONTENT_DIR } from '@/lib/seoLibrary/load';
import { validateLibrary } from '@/lib/seoLibrary/validate';
import { textOfPage } from '@/lib/seoLibrary/text';
import { isPublished } from '@/lib/seoLibrary/publish';
import { FEATURE_VOCABULARY, UNVERIFIED, VERIFIED_STATEMENTS } from '@/content/calldeskFacts';

// Guards for the first publish wave (src/content/publish.json) and the fixes made while reading the rendered pages.
const lib = loadLibrary(DEFAULT_CONTENT_DIR);
const result = validateLibrary(lib, new Date());

const WAVE1 = [
  ...['vapi', 'retell-ai', 'bland-ai', 'synthflow', 'elevenlabs-agents', 'thunderphone'].flatMap((s) => [`compare:${s}`, `alternatives:${s}`]),
  ...['vapi', 'retell-ai', 'bland-ai'].map((s) => `migrate:${s}`),
  ...['hvac-companies', 'plumbing-companies', 'roofing-contractors', 'electricians', 'landscaping-companies', 'cleaning-services'].map((s) => `industries:${s}`),
  ...['inbound-call-answering', 'after-hours-answering', 'appointment-booking', 'missed-call-callback'].map((s) => `use-cases:${s}`),
];

describe('wave 1 publish list', () => {
  it('is exactly the 25 agreed entries', () => {
    expect([...lib.publish.published].sort()).toEqual([...WAVE1].sort());
    expect(WAVE1).toHaveLength(25);
  });
  it('publishes no page that needs counsel review first, and no thin enterprise competitor', () => {
    for (const s of ['medical-practices', 'law-firms', 'insurance-agencies', 'mortgage-brokers', 'accounting-and-tax-firms', 'car-dealerships']) {
      expect(lib.publish.published.some((e) => e.endsWith(s))).toBe(false);
    }
    for (const s of ['parloa', 'polyai', 'dialpad-ai', 'slang-ai', 'rosie']) expect(lib.publish.published.some((e) => e.endsWith(`:${s}`))).toBe(false);
  });
  it('every published page passes the gate with no error and none of the warnings fixed in this wave', () => {
    const published = result.pages.filter((p) => isPublished(lib.publish, p.type, p.slug));
    expect(published).toHaveLength(25);
    expect(result.errors).toEqual([]);
    const fixed = ['TITLE_LONG', 'DESC_LONG', 'FEATURE_NOT_IN_FACTS'];
    expect(result.warnings.filter((w) => fixed.includes(w.code))).toEqual([]);
  });
});

describe('migrate pages', () => {
  it('render for 12 competitors, each at least 55% unique with no near-duplicate warning', () => {
    const rep = result.similarity.migrate;
    expect(rep.unique).toHaveLength(12);
    for (const u of rep.unique) expect(u.share, u.id).toBeGreaterThanOrEqual(0.55);
    expect(result.warnings.filter((w) => w.where.startsWith('/migrate') && (w.code === 'SIMILAR' || w.code === 'LOW_UNIQUE_SHARE'))).toEqual([]);
  });
  it('states the SIP and porting position and never promises porting', () => {
    const p = result.pages.find((x) => x.path === '/migrate/from-vapi')!;
    const text = textOfPage(p);
    expect(text).toMatch(/does not offer SIP trunking/);
    expect(text).toMatch(/not a promise that a number can move/);
    expect(VERIFIED_STATEMENTS.porting.mayBePromisedOnPages).toBe(false);
    expect(VERIFIED_STATEMENTS.sipTrunking).toBe(false);
  });
  it('mentions Bland\'s migration deadline only because its data file cites it', () => {
    const bland = result.pages.find((x) => x.path === '/migrate/from-bland-ai')!;
    expect(textOfPage(bland)).toContain('November 15, 2026');
    const vapi = result.pages.find((x) => x.path === '/migrate/from-vapi')!;
    expect(textOfPage(vapi)).not.toContain('November 15');
  });
});

describe('copy that was fixed while reading the rendered pages', () => {
  const published = result.pages.filter((p) => isPublished(lib.publish, p.type, p.slug));
  const BAD: [RegExp, string][] = [
    [/Standard and Pro voice(?!s)/, 'plan names joined with and, should be or'],
    [/listen to (?:a )?calls? live|watch calls live|watch calls as they happen/i, 'the Live Calls page shows state, not audio'],
    [/\bthe data records\b|single-source|perMinuteUsd|extracted text/i, 'internal research wording'],
    [/Listed price per minute/, 'a bare per-minute row invites an unfair comparison'],
    [/\b0\.\d+ USD\b/, 'machine-formatted price'],
    [/recorded in our data/i, 'internal wording'],
    [/ranked reading list/i, 'summaries are not ranked'],
    [/\b[A-Za-z]+s's\b/, 'possessive of a name ending in s'],
  ];
  for (const [re, why] of BAD) {
    it(`no published page matches ${re} (${why})`, () => {
      for (const p of published) expect(textOfPage(p, { skip: ['sources'] }), p.path).not.toMatch(re);
    });
  }
  it('no page claims bring-your-own carrier without saying how a number reaches Calldesk', () => {
    for (const p of published.filter((x) => x.type === 'compare')) expect(textOfPage(p)).toMatch(/no SIP trunking|does not offer SIP trunking/);
  });
  it('the Calldesk card says SIP trunking is not offered', () => {
    const alt = published.find((p) => p.type === 'alternatives')!;
    expect(textOfPage(alt)).toMatch(/SIP trunking is not offered/);
  });
});

describe('facts file', () => {
  it('every vocabulary entry names its evidence', () => {
    for (const f of FEATURE_VOCABULARY) expect(f.backedBy.length, f.name).toBeGreaterThan(5);
  });
  it('keeps the not-published list honest: no page states any of them', () => {
    expect(UNVERIFIED.join(' ')).toMatch(/SIP trunking/);
    const published = result.pages.filter((p) => isPublished(lib.publish, p.type, p.slug) && ['industry', 'use-case'].includes(p.type));
    for (const p of published) expect(textOfPage(p), p.path).not.toMatch(/\b(uptime|latency|data residency|encrypt|99\.9)/i);
  });
});
