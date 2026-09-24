import { describe, it, expect } from 'vitest';
import {
  calldesk, readaloud, freight, homeservices, dental, insurance, resolveProduct, scopeToProduct, productInsertFields,
} from '@/lib/outreach/products';
import { scoreLead } from '@/lib/outreach/discovery/score';
import {
  evaluateBroker, toCandidate, describeBroker, mcNumber, cleanEmail, isFreeMail, isBigBroker, stripZeros, titleCase,
  type AuthorityRow, type CensusRow,
} from '@/lib/outreach/discovery/freightFmcsa';
import { verticalQueries, looksLikeVertical } from '@/lib/outreach/discovery/verticalSearch';
import { tidyBody } from '@/lib/outreach/agencyDraft';

const NOW = new Date('2026-09-24T00:00:00Z');
const auth = (o: Partial<AuthorityRow> = {}): AuthorityRow => ({
  docket_number: 'MC1740178', dot_number: '04012345', broker_stat: 'A', broker_rev_pend: 'N', bond_file: 'Y',
  legal_name: 'SAGE8 LOGISTICS LLC', bus_city: 'NORTON SHORES', bus_state_code: 'MI', bus_ctry_code: 'US', ...o,
});
const census = (o: Partial<CensusRow> = {}): CensusRow => ({
  dot_number: '4012345', email_address: 'Curtis@Sage8Logistics.com', status_code: 'A', add_date: '20250616', power_units: '0', total_drivers: '0', ...o,
});

describe('resolveProduct', () => {
  it('defaults to calldesk for unset/unknown', () => {
    expect(resolveProduct(undefined)).toBe(calldesk);
    expect(resolveProduct('')).toBe(calldesk);
    expect(resolveProduct('nope')).toBe(calldesk);
  });
  it('resolves the four verticals and keeps readaloud', () => {
    expect(resolveProduct('freight')).toBe(freight);
    expect(resolveProduct('homeservices')).toBe(homeservices);
    expect(resolveProduct('dental')).toBe(dental);
    expect(resolveProduct('insurance')).toBe(insurance);
    expect(resolveProduct('readaloud')).toBe(readaloud);
  });
  it('verticals share the calldesk tables under distinct product values and state dirs', () => {
    const vs = [freight, homeservices, dental, insurance];
    for (const v of vs) {
      expect(v.tablePrefix).toBe('calldesk_outreach');
      expect(v.sharedTableProductValue).toBe(`calldesk:${v.id}`);
      expect(v.stateDirName).toBe(`.calldesk-${v.id}-outreach`);
      expect(productInsertFields(v)).toEqual({ product: `calldesk:${v.id}` });
      expect(v.signature).toBe('Sushanth & Deepika\nCo-founders, Calldesk');
    }
    expect(new Set(vs.map((v) => v.stateDirName)).size).toBe(4);
  });
  it('calldesk default path is not a vertical and keeps its scoping', () => {
    expect(calldesk.vertical).toBeUndefined();
    expect(readaloud.vertical).toBeUndefined();
    expect(productInsertFields(calldesk)).toEqual({ product: 'calldesk' });
    const q = { eq: (c: string, v: string) => ({ c, v }) };
    expect(scopeToProduct(q, freight)).toEqual({ c: 'product', v: 'calldesk:freight' });
  });
  it('discovery prompts are help-first, allow only the pilot terms, and forbid other pricing', () => {
    for (const v of [freight, homeservices, dental, insurance]) {
      expect(v.systemPrompt).toMatch(/not a generic sales pitch/);
      expect(v.systemPrompt).toMatch(/only pricing statement allowed is the pilot terms/);
      expect(v.offerFacts.join(' ')).toMatch(/free for two weeks, capped at 50 minutes/);
      expect(v.offerFacts.join(' ')).not.toMatch(/revenue share|20%|partner/i);
    }
  });
});

describe('FMCSA broker evaluation', () => {
  it('keeps an active broker with a published business email', () => {
    const ev = evaluateBroker(auth(), census(), NOW);
    expect(ev.keep).toBe(true);
    if (ev.keep) expect(ev.adjust).toBe(10); // business-domain +5, recent add +5
  });
  it('rejects non-brokers, pending revocation, no bond, non-US, no MC, missing/invalid email, inactive census', () => {
    const reason = (a: Partial<AuthorityRow>, c?: Partial<CensusRow> | null) => {
      const ev = evaluateBroker(auth(a), c === null ? undefined : census(c ?? {}), NOW);
      return ev.keep ? 'KEPT' : ev.reason;
    };
    expect(reason({ broker_stat: 'I' })).toMatch(/active broker/);
    expect(reason({ broker_rev_pend: 'Y' })).toMatch(/revocation/);
    expect(reason({ bond_file: 'N' })).toMatch(/bond/);
    expect(reason({ bus_ctry_code: 'CA' })).toMatch(/US/);
    expect(reason({ docket_number: 'FF123' })).toMatch(/MC/);
    expect(reason({}, null)).toMatch(/census/);
    expect(reason({}, { email_address: undefined })).toMatch(/email/);
    expect(reason({}, { email_address: 'not an email' })).toMatch(/email/);
    expect(reason({}, { status_code: 'I' })).toMatch(/inactive/);
  });
  it('drops known large brokers but keeps unrelated names containing similar letters', () => {
    expect(isBigBroker('C.H. ROBINSON WORLDWIDE INC')).toBe(true);
    expect(isBigBroker('TOTAL QUALITY LOGISTICS LLC')).toBe(true);
    expect(isBigBroker('Uber Freight')).toBe(true);
    expect(isBigBroker('UPS SUPPLY CHAIN')).toBe(true);
    expect(isBigBroker('SAGE8 LOGISTICS LLC')).toBe(false);
    expect(isBigBroker('CUPSTONE FREIGHT LLC')).toBe(false);
    expect(evaluateBroker(auth({ legal_name: 'COYOTE LOGISTICS LLC' }), census(), NOW).keep).toBe(false);
  });
  it('scores free-mail down instead of dropping, and large fleets / carriers-first down', () => {
    const gm = evaluateBroker(auth(), census({ email_address: 'x@gmail.com' }), NOW);
    expect(gm.keep && gm.adjust).toBe(-5); // -10 free mail, +5 recent
    const big = evaluateBroker(auth(), census({ power_units: '120' }), NOW);
    expect(big.keep && big.adjust).toBe(-5); // +5 biz email, -15 fleet, +5 recent
    const own = evaluateBroker(auth(), census({ power_units: '3' }), NOW);
    expect(own.keep && own.adjust).toBe(5); // +5, -5, +5
    const old = evaluateBroker(auth(), census({ add_date: '20040101' }), NOW);
    expect(old.keep && old.adjust).toBe(5);
  });
  it('normalizes identifiers and builds a registry-only description', () => {
    expect(mcNumber('MC012892')).toBe('12892');
    expect(mcNumber('FF001')).toBeNull();
    expect(stripZeros('02217388')).toBe('2217388');
    expect(cleanEmail(' Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(cleanEmail('a@b')).toBeNull();
    expect(isFreeMail('a@Gmail.com')).toBe(true);
    expect(isFreeMail('a@sage8logistics.com')).toBe(false);
    expect(titleCase('SKY 2 C FREIGHT SYSTEMS INC')).toBe('Sky 2 C Freight Systems INC');
    const ev = evaluateBroker(auth({ dba_name: 'SAGE EIGHT' }), census(), NOW);
    if (!ev.keep) throw new Error('expected keep');
    const c = toCandidate(auth({ dba_name: 'SAGE EIGHT' }), census(), ev);
    expect(c.email).toBe('curtis@sage8logistics.com');
    expect(c.name).toBe('Sage8 Logistics LLC');
    expect(c.dba).toBe('Sage Eight');
    const d = describeBroker(c);
    expect(d.location).toBe('Norton Shores, MI');
    expect(d.description).toContain('MC-1740178');
    expect(d.description).not.toMatch(/employees|revenue|customers/i);
  });
});

describe('vertical scoring vocabulary', () => {
  it('scores small/independent up and chains/DSOs/captives down', () => {
    const small = scoreLead({ tier: null, location: null, description: 'Family owned dental practice accepting new patients' }, undefined, dental).score;
    const dso = scoreLead({ tier: null, location: null, description: 'Aspen Dental, 900+ locations nationwide' }, undefined, dental).score;
    expect(small).toBeGreaterThan(dso);
    const captive = scoreLead({ tier: null, location: null, description: 'State Farm agent' }, undefined, insurance).score;
    const indep = scoreLead({ tier: null, location: null, description: 'Independent insurance agency, personal lines' }, undefined, insurance).score;
    expect(indep).toBeGreaterThan(captive);
    const franchise = scoreLead({ tier: null, location: null, description: 'Franchise plumbing, nationwide' }, undefined, homeservices).score;
    const local = scoreLead({ tier: null, location: null, description: 'Locally owned HVAC, 24/7 emergency service' }, undefined, homeservices).score;
    expect(local).toBeGreaterThan(franchise);
    const big = scoreLead({ tier: null, location: null, description: 'Global Logistics Group' }, undefined, freight).score;
    const lil = scoreLead({ tier: null, location: null, description: 'Acme Freight Brokerage' }, undefined, freight).score;
    expect(lil).toBeGreaterThan(big);
  });
  it('calldesk vocabulary is untouched by the verticals', () => {
    expect(scoreLead({ tier: null, location: null, description: 'white-label voice agent reseller for dental' }).score).toBe(85);
  });
});

describe('vertical search helpers', () => {
  it('rotates queries deterministically by slot', () => {
    const a = verticalQueries('dental', new Date('2026-09-24T00:00:00Z'), 2);
    const b = verticalQueries('dental', new Date('2026-09-24T02:00:00Z'), 2);
    expect(a).toHaveLength(2);
    expect(a).toEqual(verticalQueries('dental', new Date('2026-09-24T00:30:00Z'), 2));
    expect(a).not.toEqual(b);
    expect(a[0]).toMatch(/ in [A-Z]/);
  });
  it('verifies a homepage reads like the vertical', () => {
    expect(looksLikeVertical('dental', '<h1>Smith Family Dentistry</h1>')).toBe(true);
    expect(looksLikeVertical('dental', '<h1>Best pizza in town</h1>')).toBe(false);
    expect(looksLikeVertical('homeservices', 'Emergency plumbing and drain cleaning')).toBe(true);
    expect(looksLikeVertical('insurance', 'Independent insurance agency')).toBe(true);
  });
});

describe('draft signature', () => {
  it('replaces any model sign-off with the fixed Calldesk signature', () => {
    const out = tidyBody('Hi there,\n\nWould 15 minutes work.\n\nBest,\nSushanth & Deepika', freight);
    expect(out.endsWith('Sushanth & Deepika\nCo-founders, Calldesk')).toBe(true);
    expect(out).toContain('Would 15 minutes work?');
  });
});
