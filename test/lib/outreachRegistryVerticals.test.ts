import { describe, it, expect } from 'vitest';
import {
  calldesk, freight, homeservices, dental, insurance, towing, septic, homecare, bailbonds, resolveProduct, productInsertFields, VERTICAL_PRODUCT_IDS,
} from '@/lib/outreach/products';
import { scoreLead } from '@/lib/outreach/discovery/score';
import { LeadIndex } from '@/lib/outreach/discovery/dedupe';
import { formatUsPhone, splitDba, describeRegistryLead, titleCase } from '@/lib/outreach/discovery/registryCommon';
import { evaluateWaTow, toWaLead, isBigTowName } from '@/lib/outreach/discovery/towingWa';
import {
  parseFlContractors, collapseFlByBusiness, evaluateFlRow, toFlLead, evaluateAustinRow, toAustinLead,
} from '@/lib/outreach/discovery/septicRegistry';
import { classifyHomecareName, evaluateIlRow, evaluateNyRow, toIlLead, toNyLead } from '@/lib/outreach/discovery/homecareRegistry';
import {
  verifyBusinessPage, extractPageText, distinctiveTokens, isAcceptableOwnSite, discoverWebsite, type BizIdentity,
} from '@/lib/outreach/discovery/websiteDiscovery';
import { verticalQueries, looksLikeVertical, VERTICAL_SEARCH } from '@/lib/outreach/discovery/verticalSearch';
import { extractEmails } from '@/lib/outreach/discovery/contactPages';

const NOW = new Date('2026-09-24T12:00:00Z');

describe('new vertical products', () => {
  const vs = [towing, septic, homecare, bailbonds];
  it('resolve by id, share the calldesk tables, and have distinct product values and state dirs', () => {
    for (const v of vs) {
      expect(resolveProduct(v.id)).toBe(v);
      expect(v.tablePrefix).toBe('calldesk_outreach');
      expect(v.sharedTableProductValue).toBe(`calldesk:${v.id}`);
      expect(v.stateDirName).toBe(`.calldesk-${v.id}-outreach`);
      expect(productInsertFields(v)).toEqual({ product: `calldesk:${v.id}` });
      expect(v.vertical?.defaultMaxFollowUps).toBe(2);
    }
    // Batch 3 added eight more verticals, covered by their own suite
    // (outreachVerticalsBatch3.test.ts). Here we assert that batch 1/2 are all
    // still registered, and that EVERY registered vertical is collision-free.
    for (const p of [freight, homeservices, dental, insurance, ...vs]) expect([...VERTICAL_PRODUCT_IDS]).toContain(p.id);
    const every = VERTICAL_PRODUCT_IDS.map((id) => resolveProduct(id));
    expect(new Set(every.map((p) => p.sharedTableProductValue)).size).toBe(VERTICAL_PRODUCT_IDS.length);
    expect(new Set(every.map((p) => p.stateDirName)).size).toBe(VERTICAL_PRODUCT_IDS.length);
    expect(resolveProduct('calldesk')).toBe(calldesk);
    expect(calldesk.vertical).toBeUndefined();
  });
  it('drafts are help-first pilot offers with the vertical situation and no partner terms', () => {
    const topics: Record<string, RegExp> = { towing: /tow request comes in/, septic: /busy-season call volume/, homecare: /family calls to ask about care/, bailbonds: /intake call comes in after hours/ };
    for (const v of vs) {
      expect(v.systemPrompt).toMatch(/not a generic sales pitch/);
      expect(v.systemPrompt).toMatch(/only pricing statement allowed is the pilot terms/);
      expect(v.systemPrompt).toMatch(topics[v.id]);
      expect(v.offerFacts.join(' ')).toMatch(/free for two weeks, capped at 50 minutes/);
      expect(v.offerFacts.join(' ')).toMatch(/reply "yes"/);
      expect(v.offerFacts.join(' ')).not.toMatch(/revenue share|20%|partner/i);
    }
    expect(bailbonds.systemPrompt).toMatch(/legal advice/);
    expect(bailbonds.followUpSystemPrompt).toMatch(/legal advice/);
    expect(towing.systemPrompt).not.toMatch(/legal advice/);
    expect(dental.systemPrompt).not.toMatch(/legal advice/);
  });
  it('registry verticals may only state the registry listing', () => {
    for (const v of [towing, septic, homecare]) expect(v.systemPrompt).toMatch(/registry/);
  });
  it('score vocabulary: small operators up, chains down', () => {
    const s = (p: typeof towing, d: string) => scoreLead({ tier: null, location: null, description: d }, undefined, p).score;
    expect(s(towing, 'Family owned towing, 24/7')).toBeGreaterThan(s(towing, 'Nationwide towing corporate franchise'));
    expect(s(septic, 'Locally owned septic pumping')).toBeGreaterThan(s(septic, 'Septic holdings, 40 locations'));
    expect(s(homecare, 'Independent home care since 2004')).toBeGreaterThan(s(homecare, 'National brand home care franchise'));
    expect(s(bailbonds, 'Family owned bail bonds, 24/7')).toBeGreaterThan(s(bailbonds, 'Bad Boys Bail Bonds nationwide franchise'));
  });
  it('source_key prefixes are product-namespaced so the global unique index cannot collide', () => {
    const keys = [
      toWaLead({ license_number: '05897', location_name: 'A', location_city: 'X', location_state: 'WA' }, { adjust: 0, reasons: [] }).sourceKey,
      toFlLead({ coa: 'SA1', cor: 'SR1', level: 'R', person: 'P', business: 'B', street: null, city: 'C', state: 'FL', zip: '1', phone: null, expires: '2027-01-01', county: '' }, { adjust: 0, reasons: [] }).sourceKey,
      toAustinLead({ business_name: 'B', lwd_id: '9' }, { adjust: 0, reasons: [] }).sourceKey,
      toIlLead({ facility_name: 'B', license_number: '1' }, { adjust: 0, reasons: [] }).sourceKey,
      toNyLead({ agency: 'B', license_number: '1' }, { adjust: 0, reasons: [] }).sourceKey,
      `bailbonds:search:example.com`,
    ];
    expect(keys[0]).toBe('towing:wa:05897');
    expect(keys[1]).toBe('septic:fl:SA1');
    expect(keys[2]).toBe('septic:atx:9');
    // Same licence number in two states / two homecare registries never collides.
    expect(keys[3]).toBe('homecare:il:1');
    expect(keys[4]).toBe('homecare:ny:1');
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).not.toMatch(/^(search|retell|job_posting|review_site|freight|homeservices|dental|insurance|kk):/);
  });
});

describe('registryCommon', () => {
  it('formats US phones and rejects junk', () => {
    expect(formatUsPhone('5122584000')).toBe('(512) 258-4000');
    expect(formatUsPhone('+1 (509) 455-8622')).toBe('(509) 455-8622');
    expect(formatUsPhone('12345')).toBeNull();
    expect(formatUsPhone(undefined)).toBeNull();
  });
  it('splits DBA and fixes possessive casing', () => {
    expect(splitDba('Crown Home Health Services LLC - DBA Loyal Home Health')).toEqual({ legal: 'Crown Home Health Services LLC', dba: 'Loyal Home Health' });
    expect(splitDba('Plain Name Inc')).toEqual({ legal: 'Plain Name Inc', dba: null });
    expect(titleCase("DICK'S TOWING, INC.")).toBe("Dick's Towing, INC.");
  });
  it('description is registry-only, never includes the legal name or size/problem claims', () => {
    const d = describeRegistryLead({ typeLabel: 'registered tow truck operator', registryName: 'Washington State Department of Licensing', location: 'Cheney, WA', legalName: 'Some Person', name: 'Rogers Towing' });
    expect(d).toBe('Listed in the Washington State Department of Licensing registry as a registered tow truck operator, based in Cheney, WA.');
    expect(describeRegistryLead({ typeLabel: 'x', registryName: 'R', location: 'TX', legalName: null, name: 'n' })).toBe('Listed in the R registry as a x.');
  });
});

describe('towing (WA DOL)', () => {
  const row = (o = {}) => ({ license_type: 'Registered Tow Truck Operator', license_number: '05317', license_status: 'Active', expiration_date: '2027-01-31T00:00:00.000', location_name: "DIVINE'S TOWING", business_name: 'DIVINE CORPORATION', location_city: 'SPOKANE', location_state: 'WA', phone_number: '(509) 455-8622', ...o });
  it('keeps an active company registration and builds a lead with the phone on it', () => {
    const ev = evaluateWaTow(row(), NOW);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    const l = toWaLead(row(), ev);
    expect(l).toMatchObject({ sourceKey: 'towing:wa:05317', name: "Divine's Towing", legalName: 'Divine Corporation', location: 'Spokane, WA', phone: '(509) 455-8622', licenseId: '05317' });
    expect(l.description).toBe('Listed in the Washington State Department of Licensing registry as a registered tow truck operator, based in Spokane, WA.');
  });
  it('rejects inactive, expired, branch-storage, unnamed, and insurer/auction names; scores down without phone', () => {
    const why = (o: object) => { const e = evaluateWaTow(row(o), NOW); return e.keep ? 'KEPT' : e.reason; };
    expect(why({ license_status: 'Expired' })).toMatch(/not active/);
    expect(why({ expiration_date: '2026-01-01T00:00:00.000' })).toMatch(/expired/);
    expect(why({ license_type: 'Registered Tow Truck Operator Branch Storage' })).toMatch(/HQ/);
    expect(why({ location_name: '', business_name: '' })).toMatch(/name/);
    expect(why({ location_name: 'COPART OF WASHINGTON', business_name: 'COPART INC' })).toMatch(/insurer/);
    const np = evaluateWaTow(row({ phone_number: undefined }), NOW);
    expect(np.keep && np.adjust).toBe(-5);
    expect(isBigTowName('Miller Towing')).toBe(false);
  });
});

const FL_HTML = `<html><body><table>
<tr><th>County</th><th>COR<br>COA</th><th>M/R</th><th>Name</th><th>Address</th><th>Phone</th><th>Exp</th></tr>
<tr><td width="121">ALACHUA</td><td>SM0051477<br>SA0192024</td><td>M</td><td>CROSBY, DONALD R  <br>DC ENTERPRISES A/K/A D C SEPTIC</td><td>21924 SE 41ST LANE<br>HAWTHORNE, FL  32640-</td><td>(352) 494-3881</td><td>9/30/2027</td></tr>
<tr><td>ALACHUA</td><td>SR0191842<br>SA0091596</td><td>R</td><td>CROSBY, HERBERT A  <br>DAMPIER SEPTIC TANK, INC.</td><td>7030 NW 23RD WAY<br>GAINESVILLE, FL  32653-</td><td>(352) 665-9693</td><td>9/30/2025</td></tr>
<tr><td>ALACHUA</td><td>SR0890464<br>SA0091596</td><td>R</td><td>DAMPIER, BRENDA J  <br>DAMPIER SEPTIC TANK, INC.</td><td>7030 NW 23RD WAY<br>GAINESVILLE, FL  32653-</td><td>(352) 665-9693</td><td>9/30/2027</td></tr>
<tr><td></td><td>SR0991458<br>SA0991011</td><td>R</td><td>WHEELER, CODY A  <br>CODY WHEELER EXCAVATING</td><td>412 KIRKPATRICK RD<br>WINCHESTER, OH  45697-</td><td>(937) 217-5978</td><td>9/30/2027</td></tr>
<tr><td>DADE</td><td>SR0777777<br></td><td>R</td><td>SOLO, SAM  </td><td>1 MAIN ST<br>MIAMI, FL  33101-</td><td></td><td>9/30/2027</td></tr>
<tr><td>DADE</td><td>SR0888888<br>SA0888000</td><td>R</td><td>ROTO, RON  <br>ROTO-ROOTER OF MIAMI</td><td>1 MAIN ST<br>MIAMI, FL  33101-</td><td>(305) 111-2222</td><td>9/30/2027</td></tr>
</table></body></html>`;

describe('septic (FL DOH HTML + Austin)', () => {
  it('parses the listing table: ids, level, business, address, phone, expiry', () => {
    const rows = parseFlContractors(FL_HTML);
    expect(rows).toHaveLength(6); // header row (th) skipped
    expect(rows[0]).toMatchObject({
      county: 'ALACHUA', cor: 'SM0051477', coa: 'SA0192024', level: 'M', person: 'CROSBY, DONALD R',
      business: 'DC ENTERPRISES A/K/A D C SEPTIC', street: '21924 SE 41ST LANE', city: 'HAWTHORNE', state: 'FL', zip: '32640', phone: '(352) 494-3881', expires: '2027-09-30',
    });
    expect(rows[4].business).toBeNull();
    expect(rows[4].coa).toBeNull();
  });
  it('collapses people sharing a business authorization, keeping the freshest registration', () => {
    const c = collapseFlByBusiness(parseFlContractors(FL_HTML));
    const dampier = c.filter((r) => r.coa === 'SA0091596');
    expect(dampier).toHaveLength(1);
    expect(dampier[0].expires).toBe('2027-09-30');
  });
  it('filters expired, out-of-state, no-business, and national names', () => {
    const rows = parseFlContractors(FL_HTML);
    const why = (i: number) => { const e = evaluateFlRow(rows[i], NOW); return e.keep ? 'KEPT' : e.reason; };
    expect(why(0)).toBe('KEPT');
    expect(why(1)).toMatch(/expired/);
    expect(why(3)).toMatch(/not in Florida/);
    expect(why(4)).toMatch(/no business name/);
    expect(why(5)).toMatch(/national/);
    const ev = evaluateFlRow(rows[0], NOW);
    if (!ev.keep) throw new Error('keep');
    expect(ev.adjust).toBe(3); // master
    const l = toFlLead(rows[0], ev);
    expect(l).toMatchObject({ sourceKey: 'septic:fl:SA0192024', location: 'Hawthorne, FL', phone: '(352) 494-3881' });
    expect(l.description).toContain('master septic tank contractor');
  });
  it('Austin liquid waste haulers', () => {
    const r = { business_name: 'ALL CENTEX SEPTIC & DRAIN INC (ALL CEN TEX INC.)', city: 'CEDAR PARK', phone: '5122584000', lwd_id: '2' };
    const ev = evaluateAustinRow(r);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    const l = toAustinLead(r, ev);
    expect(l).toMatchObject({ sourceKey: 'septic:atx:2', name: 'All Centex Septic & Drain INC', location: 'Cedar Park, TX', phone: '(512) 258-4000' });
    expect(evaluateAustinRow({ business_name: 'ROTO-ROOTER', lwd_id: '1' }).keep).toBe(false);
    expect(evaluateAustinRow({ lwd_id: '1' }).keep).toBe(false);
    const nophone = evaluateAustinRow({ business_name: 'X Septic', lwd_id: '5' });
    expect(nophone.keep && nophone.adjust).toBe(-5);
  });
});

describe('homecare (IL IDPH + NY DOH)', () => {
  it('classifies names: institutions dropped, chains and medical scored down, non-medical up', () => {
    expect(classifyHomecareName('Blessing Hospital - DBA Blessing Home Care').keep).toBe(false);
    expect(classifyHomecareName('Genesis Health System').keep).toBe(false);
    const nm = classifyHomecareName('Golden Years Companion Care');
    expect(nm.keep && nm.adjust).toBe(8);
    const med = classifyHomecareName('Amicus Home Health LLC');
    expect(med.keep && med.adjust).toBe(-8);
    const chain = classifyHomecareName('Comfort Keepers of Naperville');
    expect(chain.keep && chain.adjust).toBeLessThan(0);
    const mixed = classifyHomecareName('Caring Companion Home Health');
    expect(mixed.keep && mixed.adjust).toBe(0); // both signals present -> neutral
  });
  it('IL: expiry filter, DBA split, phone kept on the lead, medical name noted', () => {
    const r = { facility_name: 'Crown Home Health Services LLC - DBA Loyal Home Health', city: 'Chicago', phone: '(847) 433-5650', contact_name: 'Jane Doe', license_number: '1011992', exp_date: '2027-03-31T00:00:00.000' };
    const ev = evaluateIlRow(r, NOW);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    expect(ev.adjust).toBe(-8);
    const l = toIlLead(r, ev);
    expect(l).toMatchObject({ sourceKey: 'homecare:il:1011992', name: 'Loyal Home Health', legalName: 'Crown Home Health Services LLC', phone: '(847) 433-5650', contactName: 'Jane Doe', location: 'Chicago, IL' });
    expect(l.description).not.toMatch(/Jane|Crown/);
    expect(evaluateIlRow({ ...r, exp_date: '2026-01-01T00:00:00.000' }, NOW).keep).toBe(false);
  });
  it('NY: only registration_status Yes, dba preferred when it differs, no phone penalty', () => {
    const r = { license_number: '2587L001', agency: 'Stacey Ball', dba: 'Changing Seasons Home Care', city: 'FAYETTEVILLE', registration_status: 'Yes' };
    const ev = evaluateNyRow(r);
    expect(ev.keep && ev.adjust).toBe(8);
    if (!ev.keep) return;
    const l = toNyLead(r, ev);
    expect(l).toMatchObject({ sourceKey: 'homecare:ny:2587L001', name: 'Changing Seasons Home Care', legalName: 'Stacey Ball', phone: null, location: 'Fayetteville, NY' });
    expect(l.description).not.toMatch(/Stacey/);
    expect(evaluateNyRow({ ...r, registration_status: 'No' }).keep).toBe(false);
  });
});

describe('website verification (name + city/state, false-positive controls)', () => {
  const page = (title: string, body: string) => extractPageText(`<html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`);
  const id: BizIdentity = { name: "Fred's Towing Service, INC.", legalName: null, city: 'Enumclaw', state: 'WA', phone: '(360) 825-3100' };
  it('accepts the right business by phone', () => {
    const v = verifyBusinessPage([page("Fred's Towing Service", '<p>Call 360-825-3100 for a tow</p>')], id);
    expect(v).toMatchObject({ ok: true, name: true, phone: true });
  });
  it('accepts by city + state when the phone is not shown', () => {
    expect(verifyBusinessPage([page("Fred's Towing", '<p>Serving Enumclaw, WA and the plateau</p>')], id).ok).toBe(true);
    expect(verifyBusinessPage([page("Fred's Towing", '<p>Serving Enumclaw, Washington</p>')], id).ok).toBe(true);
  });
  it('rejects a same-named business in another city/state', () => {
    const v = verifyBusinessPage([page("Fred's Towing Service", '<p>Tulsa, OK. Call 918-555-0100</p>')], id);
    expect(v.name).toBe(true);
    expect(v.ok).toBe(false);
  });
  it('rejects city without the state, and state without the city', () => {
    expect(verifyBusinessPage([page("Fred's Towing", '<p>Enumclaw</p>')], id).ok).toBe(false);
    expect(verifyBusinessPage([page("Fred's Towing", '<p>Seattle, WA</p>')], id).ok).toBe(false);
  });
  it('rejects a page that has the location but not the business name', () => {
    expect(verifyBusinessPage([page('Bob Roadside Help', '<p>Enumclaw, WA 360-825-3100</p>')], id).ok).toBe(false);
  });
  it('requires ALL distinctive name tokens', () => {
    const two: BizIdentity = { name: 'Green Valley Septic', legalName: null, city: 'Naples', state: 'FL', phone: null };
    expect(verifyBusinessPage([page('Green Septic', '<p>Naples, FL</p>')], two).ok).toBe(false);
    expect(verifyBusinessPage([page('Green Valley Septic Pumping', '<p>Naples, FL</p>')], two).ok).toBe(true);
  });
  it('a single distinctive token must be in the title/heading, not just the body', () => {
    const one: BizIdentity = { name: 'Beebe Septic Service', legalName: null, city: 'Naples', state: 'FL', phone: null };
    expect(verifyBusinessPage([page('Welcome', '<p>Our friend Beebe recommends us. Naples, FL</p>')], one).ok).toBe(false);
    expect(verifyBusinessPage([page('Beebe Septic', '<p>Naples, FL</p>')], one).ok).toBe(true);
  });
  it('a name made only of generic words needs the whole name to appear', () => {
    const gen: BizIdentity = { name: 'Home Care Services Inc', legalName: null, city: 'Naperville', state: 'IL', phone: '(630) 364-7330' };
    expect(distinctiveTokens(gen.name)).toEqual([]);
    expect(verifyBusinessPage([page('Best home care', '<p>630-364-7330</p>')], gen).ok).toBe(false);
    expect(verifyBusinessPage([page('Home Care Services Inc', '<p>630-364-7330</p>')], gen).ok).toBe(true);
  });
  it('legal name can carry the match', () => {
    const l: BizIdentity = { name: 'Pro-Tow Auburn', legalName: 'Skr Corporation', city: 'Auburn', state: 'WA', phone: '(253) 245-5454' };
    expect(verifyBusinessPage([page('Pro-Tow Auburn', '<p>253.245.5454</p>')], l).ok).toBe(true);
  });
  it('rejects directory, social and government hosts as an own site', () => {
    for (const d of ['yelp.com', 'www.facebook.com', 'm.yelp.com', 'health.state.il.us', 'idph.illinois.gov', 'dol.wa.gov', 'caring.com', 'bbb.org']) {
      expect(isAcceptableOwnSite(d.replace(/^www\./, ''))).toBe(false);
    }
    expect(isAcceptableOwnSite('fredstowinginc.com')).toBe(true);
    expect(isAcceptableOwnSite(null)).toBe(false);
  });
});

describe('discoverWebsite orchestration (fake deps)', () => {
  const id: BizIdentity = { name: 'Bankers Towing', legalName: null, city: 'Renton', state: 'WA', phone: '(425) 255-3448' };
  const html = (t: string, b: string) => `<html><head><title>${t}</title></head><body><h1>${t}</h1>${b}${'<p>filler</p>'.repeat(40)}</body></html>`;
  const deps = (search: string | (() => string), pages: Record<string, string>) => ({
    search: () => (typeof search === 'function' ? search() : search),
    fetchPage: async (url: string) => (pages[url] ? { ok: true, text: pages[url] } : { ok: false, text: '' }),
  });
  it('finds and verifies a site', async () => {
    const r = await discoverWebsite(id, 'towing', deps('{"website":"https://www.bankerstowing.com/"}', { 'https://bankerstowing.com/': html('Bankers Towing', '<p>Renton, WA (425) 255-3448</p>') }));
    expect(r).toMatchObject({ status: 'found', domain: 'bankerstowing.com' });
  });
  it('falls through to /contact when the homepage lacks the location', async () => {
    const r = await discoverWebsite(id, 'towing', deps('{"website":"bankerstowing.com"}', {
      'https://bankerstowing.com/': html('Bankers Towing', '<p>24 hour towing</p>'),
      'https://bankerstowing.com/contact': html('Contact', '<p>Renton, WA</p>'),
    }));
    expect(r.status).toBe('found');
  });
  it('returns none for null, excluded host, unverifiable site, and a wrong-city namesake', async () => {
    expect((await discoverWebsite(id, 'x', deps('{"website":null}', {}))).status).toBe('none');
    const excl = await discoverWebsite(id, 'x', deps('{"website":"https://www.yelp.com/biz/bankers"}', {}));
    expect(excl).toMatchObject({ status: 'none', reason: expect.stringMatching(/excluded host/) });
    const dead = await discoverWebsite(id, 'x', deps('{"website":"https://bankerstowing.com"}', {}));
    expect(dead).toMatchObject({ status: 'none', reason: expect.stringMatching(/did not verify/) });
    const other = await discoverWebsite(id, 'x', deps('{"website":"https://bankerstowing.com"}', { 'https://bankerstowing.com/': html('Bankers Towing', '<p>Austin, TX 512-000-1111</p>') }));
    expect(other).toMatchObject({ status: 'none', reason: expect.stringMatching(/did not verify/) });
  });
  it('a failed search is reported as a search failure (so the lead is retried, not written off)', async () => {
    const r = await discoverWebsite(id, 'x', deps(() => { throw new Error('claude CLI exited 1'); }, {}));
    expect(r).toMatchObject({ status: 'none', reason: expect.stringMatching(/^search failed/) });
  });
});

describe('bail bonds search vertical', () => {
  it('rotates queries and knows what a bail bond homepage looks like', () => {
    const q = verticalQueries('bailbonds', new Date('2026-09-24T00:00:00Z'), 2);
    expect(q).toHaveLength(2);
    expect(q[0]).toMatch(/bail/i);
    expect(looksLikeVertical('bailbonds', '<h1>Smith Bail Bonds - 24 hours</h1>')).toBe(true);
    expect(looksLikeVertical('bailbonds', '<h1>Smith Plumbing</h1>')).toBe(false);
  });
  it('never queries states where commercial bail bonding is prohibited', () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24 * 400; h += 2) for (const q of verticalQueries('bailbonds', new Date(Date.UTC(2026, 0, 1, h)), 2)) seen.add(q.split(' in ').pop() as string);
    for (const st of ['Illinois', 'Kentucky', 'Nebraska', 'Oregon', 'Wisconsin']) expect(seen.has(st)).toBe(false);
    expect(seen.has('Missouri')).toBe(true);
    // dental now rotates through metros (city-level); other state-based verticals still rotate every state
    const dseen = new Set<string>();
    for (let h = 0; h < 24 * 400; h += 2) for (const q of verticalQueries('dental', new Date(Date.UTC(2026, 0, 1, h)), 2)) dseen.add(q.split(' in ').pop() as string);
    expect(dseen.has('Chicago, IL')).toBe(true);
  });
  it('excludes aggregators/lead-gen by host and by page text', () => {
    const d = VERTICAL_SEARCH.bailbonds;
    for (const h of ['bail.com', 'bailbonds.com', 'justia.com', 'vinelink.com', 'yelp.com'].filter((h) => h !== 'yelp.com')) expect(d.hostExclusions).toContain(h);
    expect(d.rejectIf!.test('Find a bail bondsman in your state. Bail bonds nationwide network')).toBe(true);
    expect(d.rejectIf!.test('Our network will connect you with a local bail agent')).toBe(true);
    expect(d.rejectIf!.test('Family owned bail bonds in Tulsa. Call us any time.')).toBe(false);
  });
});

describe('contact extraction', () => {
  it('strips a percent-encoded space left by mailto:%20', () => {
    expect(extractEmails('<a href="mailto:%20info@acme.com">x</a>', 'acme.com')).toEqual(['info@acme.com']);
    expect(extractEmails('info@acme.com and %20%20sales@acme.com', 'acme.com').sort()).toEqual(['info@acme.com', 'sales@acme.com']);
  });
});

describe('LeadIndex.rows', () => {
  it('lists every row including those without a source_key', () => {
    const idx = new LeadIndex([{ id: '1', company_name: 'A' }, { id: '2', company_name: 'B', source_key: 'k' }]);
    expect(idx.rows().map((r) => r.id).sort()).toEqual(['1', '2']);
    idx.add({ id: '3', company_name: 'C' });
    expect(idx.rows()).toHaveLength(3);
  });
});
