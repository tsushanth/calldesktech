import { describe, it, expect } from 'vitest';
import {
  calldesk, resolveProduct, productInsertFields, VERTICAL_PRODUCT_IDS,
  childcare, accounting, realestate, lodging, funeral, physio, taxi, vets,
  freight, towing, dental,
} from '@/lib/outreach/products';
import { scoreLead } from '@/lib/outreach/discovery/score';
import { detectDraftLanguage } from '@/lib/outreach/language';
import { registryLeadRow } from '@/lib/outreach/discovery/pipeline';
import {
  evaluateTxRow, toTxLead, evaluateWaRow, toWaLead, evaluatePaRow, toPaLead,
  scoreChildcareRow, toCapacity, toDomain, waLicenseId, paLicenseId,
  childcareSourceForSlot, CHILDCARE_SOURCES, TX_TYPES, WA_TYPE_LABEL, PA_TYPE_LABEL,
} from '@/lib/outreach/discovery/childcareUs';

const BATCH3 = [childcare, accounting, realestate, lodging, funeral, physio, taxi, vets];

describe('batch-3 vertical products', () => {
  it('are registered, share the calldesk tables, and never collide', () => {
    for (const v of BATCH3) {
      expect(resolveProduct(v.id)).toBe(v);
      expect(v.tablePrefix).toBe('calldesk_outreach');
      expect(v.sharedTableProductValue).toBe(`calldesk:${v.id}`);
      expect(v.stateDirName).toBe(`.calldesk-${v.id}-outreach`);
      expect(productInsertFields(v)).toEqual({ product: `calldesk:${v.id}` });
      expect(v.vertical?.defaultMaxFollowUps).toBe(2);
      expect([...VERTICAL_PRODUCT_IDS]).toContain(v.id);
    }
    expect(VERTICAL_PRODUCT_IDS.length).toBe(16);
    const every = VERTICAL_PRODUCT_IDS.map((id) => resolveProduct(id));
    expect(new Set(every.map((p) => p.sharedTableProductValue)).size).toBe(16);
    expect(new Set(every.map((p) => p.stateDirName)).size).toBe(16);
    // The exports must not be aliases of one another (the old positional
    // VERTICAL_DEFS[n] lookup made that failure mode easy).
    expect(new Set(every).size).toBe(16);
    expect(resolveProduct('calldesk')).toBe(calldesk);
    // An unknown vertical still falls back to calldesk rather than throwing.
    expect(resolveProduct('nosuchvertical')).toBe(calldesk);
  });

  it('carry the same help-first capped-pilot offer and no partner terms', () => {
    for (const v of BATCH3) {
      expect(v.systemPrompt).toMatch(/not a generic sales pitch/);
      expect(v.systemPrompt).toMatch(/only pricing statement allowed is the pilot terms/);
      expect(v.offerFacts.join(' ')).toMatch(/free for two weeks, capped at 50 minutes of calls, no credit card/);
      expect(v.offerFacts.join(' ')).toMatch(/reply "yes"/);
      expect(v.offerFacts.join(' ')).not.toMatch(/revenue share|20%|partner/i);
      // Never claim an integration with their software.
      expect(v.offerFacts.join(' ')).toMatch(/Do not claim integrations/);
      expect(v.signature).toBe('Sushanth & Deepika\nCo-founders, Calldesk');
      expect(v.vertical?.leadLabel).toBeTruthy();
    }
  });

  it('each prompt names its own situation, lead label and registry fact', () => {
    const situations: Record<string, RegExp> = {
      childcare: /staff is with the children and a parent calls/,
      accounting: /heads-down on returns in busy season/,
      realestate: /out at viewings or with clients/,
      lodging: /turning over rooms, checking guests in/,
      funeral: /during the night, or while a director is with another family/,
      physio: /therapists are all in with patients/,
      taxi: /dispatcher is already on another call/,
      vets: /in consults or surgery/,
    };
    for (const v of BATCH3) {
      expect(v.systemPrompt).toMatch(situations[v.id]);
      expect(v.followUpSystemPrompt).toMatch(situations[v.id]);
      expect(v.systemPrompt).toContain(v.vertical!.leadPlural);
    }
  });

  it('compliance extraRules land in BOTH the first-touch and the follow-up prompt', () => {
    const rules: Record<string, RegExp> = {
      childcare: /Never refer to, ask about, or speculate about individual children/,
      accounting: /Never give or imply tax, accounting, legal or financial advice/,
      realestate: /protected characteristic/,
      lodging: /Never state or imply availability, a rate/,
      funeral: /No sales language of any kind/,
      physio: /Never give or imply clinical, medical or rehabilitation advice/,
      taxi: /Never state or imply a fare/,
      vets: /Never give or imply veterinary, medical or first-aid advice/,
    };
    for (const v of BATCH3) {
      expect(v.systemPrompt).toMatch(rules[v.id]);
      expect(v.followUpSystemPrompt).toMatch(rules[v.id]);
    }
    // Rules must not leak across verticals.
    expect(vets.systemPrompt).not.toMatch(/protected characteristic/);
    expect(towing.systemPrompt).not.toMatch(/veterinary/);
    expect(childcare.systemPrompt).not.toMatch(/fare/);
  });

  it('the funeral copy is sensitive: no sales, urgency, or revenue framing', () => {
    for (const p of [funeral.systemPrompt, funeral.followUpSystemPrompt]) {
      expect(p).toMatch(/bereavement/);
      expect(p).toMatch(/plainly, quietly, and with respect/);
      expect(p).toMatch(/no reply is needed/);
      expect(p).toMatch(/no mention of missed revenue, lost business, growth, leads, conversion, or opportunity/);
      expect(p).toMatch(/Never call a bereaved family a "customer"/);
    }
    // The generic no-hype rules still apply on top.
    expect(funeral.systemPrompt).toMatch(/No hype words, no emojis/);
  });

  it('score vocabulary: small and independent up, chains and corporates down', () => {
    const s = (p: typeof childcare, d: string) => scoreLead({ tier: null, location: null, description: d }, undefined, p).score;
    expect(s(childcare, 'Little Acorns Preschool, family owned')).toBeGreaterThan(s(childcare, 'KinderCare Learning Center franchise'));
    expect(s(childcare, 'Sunnyside Daycare, locally owned')).toBeGreaterThan(s(childcare, 'YMCA of Greater Seattle school district program'));
    expect(s(accounting, 'Independent CPA and bookkeeping practice since 1998')).toBeGreaterThan(s(accounting, 'H&R Block tax office nationwide'));
    expect(s(realestate, 'Family owned realty brokerage')).toBeGreaterThan(s(realestate, 'Keller Williams Realty franchise nationwide'));
    expect(s(lodging, 'Owner-operated bed and breakfast since 1994')).toBeGreaterThan(s(lodging, 'Holiday Inn Express franchise, 30 locations'));
    expect(s(funeral, 'Independent family owned funeral home since 1921')).toBeGreaterThan(s(funeral, 'Dignity Memorial funeral home, corporate'));
    expect(s(physio, 'Independent physiotherapy and chiropractic clinic')).toBeGreaterThan(s(physio, 'ATI Physical Therapy, 900 locations nationwide'));
    expect(s(taxi, 'Family owned taxi and private hire, 24/7 dispatch')).toBeGreaterThan(s(taxi, 'Uber national ride-hailing platform'));
    expect(s(vets, 'Independent small animal veterinary clinic')).toBeGreaterThan(s(vets, 'VCA Animal Hospital, corporate group'));
    // The vertical word itself is worth something.
    expect(s(vets, 'Riverside Veterinary Clinic')).toBeGreaterThan(s(vets, 'Riverside Widgets'));
  });
});

describe('draft language rule (task 2)', () => {
  const ALL = [...BATCH3, freight, towing, dental];
  it('no vertical prompt says "Write in English." unconditionally any more', () => {
    for (const v of ALL) {
      expect(v.systemPrompt).not.toMatch(/^- Write in English\.$/m);
      expect(v.followUpSystemPrompt).not.toMatch(/^- Write in English\.$/m);
    }
  });
  it('every vertical prompt makes English the default and the target language the override', () => {
    for (const v of ALL) {
      for (const p of [v.systemPrompt, v.followUpSystemPrompt]) {
        expect(p).toMatch(/Write in English UNLESS a "Target language" is given in the lead data/);
        expect(p).toMatch(/fluently and naturally in that language/);
        // The pilot terms may not drift in translation.
        expect(p).toMatch(/must mean exactly the same in that language/);
        // The English back-translation for review must still be produced.
        expect(p).toMatch(/ALSO return translationSubject and translationBody/);
        expect(p).toMatch(/If no target language is given, omit both fields/);
      }
    }
    expect(childcare.systemPrompt).toMatch(/ENTIRE email \(subject and body\)/);
    expect(childcare.followUpSystemPrompt).toMatch(/ENTIRE follow-up \(subject and body\)/);
  });
});

describe('detectDraftLanguage coverage (task 2)', () => {
  it('covers the required locales', () => {
    expect(detectDraftLanguage('São Paulo, Brazil')?.code).toBe('pt');
    expect(detectDraftLanguage('Rio de Janeiro, BR')?.code).toBe('pt');
    expect(detectDraftLanguage('Guadalajara, Mexico')?.code).toBe('es');
    expect(detectDraftLanguage('Monterrey, MX')?.code).toBe('es');
    expect(detectDraftLanguage('Lyon, France')?.code).toBe('fr');
    expect(detectDraftLanguage('Lyon, FR')?.code).toBe('fr');
    expect(detectDraftLanguage('Bergen, Norway')?.code).toBe('no');
    expect(detectDraftLanguage('Bergen, NO')?.code).toBe('no');
  });
  it('Quebec gets Canadian French, and beats the France pattern', () => {
    expect(detectDraftLanguage('Montreal, QC')).toEqual({ code: 'fr-CA', name: 'Canadian French' });
    expect(detectDraftLanguage('Quebec City, Quebec')).toEqual({ code: 'fr-CA', name: 'Canadian French' });
    expect(detectDraftLanguage('Montréal, Quebec, France')?.name).toBe('Canadian French');
  });
  it('Estonia and Singapore are deliberately English, not a gap', () => {
    expect(detectDraftLanguage('Tallinn, Estonia')).toBeNull();
    expect(detectDraftLanguage('Tallinn, EE')).toBeNull();
    expect(detectDraftLanguage('Singapore')).toBeNull();
    expect(detectDraftLanguage('Jurong, SG')).toBeNull();
  });
  it('US states are never mistaken for a country code', () => {
    // CA=California, DE=Delaware, IN=Indiana, NO is not a state, QC is not a state.
    for (const loc of ['Los Angeles, CA', 'Dover, DE', 'Indianapolis, IN', 'Houston, TX', 'Seattle, WA', 'Philadelphia, PA']) {
      expect(detectDraftLanguage(loc)).toBeNull();
    }
  });
  it('null location and unknown places stay English', () => {
    expect(detectDraftLanguage(null)).toBeNull();
    expect(detectDraftLanguage('Somewhere Else')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TASK 3 — US child care ingestion. Fixtures are trimmed copies of real rows
// fetched live from each dataset on 2026-09-24.
// ---------------------------------------------------------------------------

const TX_ROW = {
  operation_id: '1186229',
  operation_type: 'Licensed Center',
  operation_number: '1572561',
  operation_name: 'Sproutstart Academy- Spring Valley Location',
  phone_number: '7135341406',
  email_address: 'Director@SproutStartAcademy.com',
  website_address: 'www.sproutstartacademy.com',
  administrator_director_name: 'Bessy Chavez',
  county: 'HARRIS',
  address_line: '1504 WIRT RD',
  city: 'HOUSTON',
  state: 'TX',
  zipcode: '77055 4919',
  total_capacity: '44',
  operation_status: 'Y',
  temporarily_closed: 'NO',
};

const WA_ROW = {
  wacompassid: '001t0000007qIQyAAM',
  famlinkid: '558002',
  sspsprovidernumber: '531493',
  providername: 'HARRAH COMMUNITY CHRISTIAN SCHOOL INC',
  doingbusinessas: 'HARRAH COMMUNITY CHRISTIAN SCHOOL',
  facilitytypegeneric: 'CHILD CARE CENTER',
  latestoperatingstatus: 'Active',
  licensecapacity: '20',
  primarycontactpersonname: 'MARIE WEGMULLER',
  primarycontactemail: 'mwegmuller@aol.com',
  physicalstreetaddress: '50 DANE AVE',
  physicalcity: 'HARRAH',
  physicalstate: 'WA',
  physicalcounty: 'YAKIMA',
};

const PA_ROW = {
  mpi_id: '103292743',
  mpi_location_id: '0001',
  master_provider_index: '103292743-0001',
  provider_type: 'Family Child Care Home',
  facility_name: 'VALERIE DAVIS',
  facility_city: 'YORK',
  facility_county: 'York',
  facility_phone: '(717) 683-7468',
  facility_email: 'PEACHESVLJ@YAHOO.COM',
  license_number: 'CER-00243752',
  capacity: '6',
  star_level: 'STAR 2',
  legal_entity_name: 'VALERIE DAVIS',
};

describe('childcare: shared helpers', () => {
  it('toCapacity reads a number and rejects junk', () => {
    expect(toCapacity('44')).toBe(44);
    expect(toCapacity('N/A')).toBeNull();
    expect(toCapacity('0')).toBeNull();
    expect(toCapacity(null)).toBeNull();
    expect(toCapacity(undefined)).toBeNull();
    expect(toCapacity('')).toBeNull();
  });
  it('toDomain normalises a hostname and rejects non-sites', () => {
    expect(toDomain('www.sproutstartacademy.com')).toBe('sproutstartacademy.com');
    expect(toDomain('https://WWW.Example.COM/about?x=1')).toBe('example.com');
    expect(toDomain('http://sub.example.co.uk/')).toBe('sub.example.co.uk');
    for (const bad of ['director@example.com', 'no website', 'facebook.com/mycentre', 'www.facebook.com', 'mysite.wixsite.com', 'notadomain', '', null, undefined]) {
      expect(toDomain(bad)).toBeNull();
    }
  });
  it('scoreChildcareRow rewards a business domain and penalises free mail, absence, and size', () => {
    const biz = scoreChildcareRow({ name: 'Little Acorns', email: 'hello@littleacorns.com', phone: '(555) 555-5555', capacity: 40 });
    const free = scoreChildcareRow({ name: 'Little Acorns', email: 'littleacorns@gmail.com', phone: '(555) 555-5555', capacity: 40 });
    const none = scoreChildcareRow({ name: 'Little Acorns', email: null, phone: '(555) 555-5555', capacity: 40 });
    expect(biz.adjust).toBeGreaterThan(free.adjust);
    expect(free.adjust).toBeGreaterThan(none.adjust);
    expect(free.reasons.join(' ')).toMatch(/free-mail/);
    expect(none.reasons.join(' ')).toMatch(/no contact email/);
    // Capacity bands.
    const tiny = scoreChildcareRow({ name: 'A', email: 'a@a.com', phone: '(555) 555-5555', capacity: 8 });
    const big = scoreChildcareRow({ name: 'A', email: 'a@a.com', phone: '(555) 555-5555', capacity: 250 });
    expect(tiny.adjust).toBeGreaterThan(biz.adjust);
    expect(big.adjust).toBeLessThan(biz.adjust);
    // No phone costs points.
    expect(scoreChildcareRow({ name: 'A', email: 'a@a.com', phone: null, capacity: null }).adjust)
      .toBeLessThan(scoreChildcareRow({ name: 'A', email: 'a@a.com', phone: '(555) 555-5555', capacity: null }).adjust);
    // Institutional programmes are marked down, not skipped.
    expect(scoreChildcareRow({ name: 'Head Start of Yakima', email: 'a@a.com', phone: null, capacity: null }).reasons.join(' '))
      .toMatch(/institutional programme/);
  });
  it('slot rotation visits all three states and is weighted by pool size', () => {
    const seen = Array.from({ length: 20 }, (_, i) => childcareSourceForSlot(i));
    expect(new Set(seen)).toEqual(new Set(['tx', 'wa', 'pa']));
    expect(seen.filter((s) => s === 'tx').length).toBe(8);
    expect(seen.filter((s) => s === 'pa').length).toBe(8);
    expect(seen.filter((s) => s === 'wa').length).toBe(4);
    // Negative and huge slots stay in range.
    expect(['tx', 'wa', 'pa']).toContain(childcareSourceForSlot(-3));
    expect(['tx', 'wa', 'pa']).toContain(childcareSourceForSlot(9_999_999));
  });
  it('every source is queried with its own filter and a bounded limit', () => {
    for (const [id, def] of Object.entries(CHILDCARE_SOURCES)) {
      expect(def.where).toBeTruthy();
      expect(Number(def.limit)).toBeGreaterThan(0);
      expect(Number(def.limit)).toBeLessThanOrEqual(50_000);
      expect(def.select.split(',').length).toBeGreaterThan(5);
      expect(['tx', 'wa', 'pa']).toContain(id);
    }
    // Only the two licensed Texas types, never 'Listed' or the placing agencies.
    expect([...TX_TYPES]).toEqual(['Licensed Center', 'Licensed Child-Care Home']);
    expect(CHILDCARE_SOURCES.tx.where).toContain("operation_status='Y'");
    expect(CHILDCARE_SOURCES.tx.where).not.toMatch(/Listed|Placing|Residential/);
    expect(CHILDCARE_SOURCES.wa.where).toBe("latestoperatingstatus='Active'");
    expect(Object.keys(PA_TYPE_LABEL)).not.toContain('Other');
  });
});

describe('childcare: Texas HHSC parser', () => {
  it('keeps an active licensed centre and states exactly the required registry fact', () => {
    const ev = evaluateTxRow(TX_ROW);
    expect(ev.keep).toBe(true);
    const lead = toTxLead(TX_ROW, ev as { adjust: number; reasons: string[] });
    expect(lead.sourceKey).toBe('childcare:tx:1572561');
    expect(lead.name).toBe('Sproutstart Academy- Spring Valley Location');
    expect(lead.location).toBe('Houston, TX');
    expect(lead.state).toBe('TX');
    expect(lead.phone).toBe('(713) 534-1406');
    expect(lead.email).toBe('director@sproutstartacademy.com');
    expect(lead.domain).toBe('sproutstartacademy.com');
    expect(lead.licenseId).toBe('1572561');
    expect(lead.contactName).toBe('Bessy Chavez');
    expect(lead.description).toBe(
      'Listed in the Texas Health and Human Services licensing data as a licensed child care operation, based in Houston, TX.',
    );
    expect(lead.signalDetail).toContain('capacity 44');
    expect(lead.country).toBeUndefined();
  });
  it('keeps a licensed child-care home under the same wording', () => {
    const home = { ...TX_ROW, operation_type: 'Licensed Child-Care Home', operation_number: '999', total_capacity: '6' };
    const ev = evaluateTxRow(home);
    expect(ev.keep).toBe(true);
    const lead = toTxLead(home, ev as { adjust: number; reasons: string[] });
    expect(lead.description).toMatch(/as a licensed child care operation/);
    expect(lead.signalDetail).toContain('Licensed Child-Care Home');
  });
  it('rejects the out-of-scope operation types, closures, and chains', () => {
    const reason = (o: Record<string, string>) => {
      const ev = evaluateTxRow({ ...TX_ROW, ...o });
      expect(ev.keep).toBe(false);
      return (ev as { reason: string }).reason;
    };
    expect(reason({ operation_type: 'Listed Family Home' })).toMatch(/not in scope/);
    expect(reason({ operation_type: 'Registered Child-Care Home' })).toMatch(/not in scope/);
    expect(reason({ operation_type: 'General Residential Operation' })).toMatch(/not in scope/);
    expect(reason({ operation_type: 'Child Placing Agency' })).toMatch(/not in scope/);
    expect(reason({ operation_status: 'N' })).toMatch(/not active/);
    expect(reason({ temporarily_closed: 'YES' })).toMatch(/temporarily closed/);
    expect(reason({ operation_name: '' })).toMatch(/no operation name/);
    expect(reason({ operation_number: '' })).toMatch(/no operation number/);
    expect(reason({ operation_name: 'KinderCare Learning Center #1234' })).toMatch(/chain/);
    expect(reason({ operation_name: 'The Goddard School of Plano' })).toMatch(/chain/);
    expect(reason({ email_address: '', phone_number: '' })).toMatch(/no contact detail/);
  });
  it('a row with no email but a phone is still kept, for website discovery', () => {
    const ev = evaluateTxRow({ ...TX_ROW, email_address: '', website_address: '' });
    expect(ev.keep).toBe(true);
    const lead = toTxLead({ ...TX_ROW, email_address: '', website_address: '' }, ev as { adjust: number; reasons: string[] });
    expect(lead.email).toBeNull();
    expect(lead.domain).toBeNull();
    expect(lead.contactSourceUrl).toBeNull();
    expect(lead.phone).toBe('(713) 534-1406');
  });
});

describe('childcare: Washington DCYF parser', () => {
  it('keeps an active centre, prefers the DBA, and words the fact from the DCYF data', () => {
    const ev = evaluateWaRow(WA_ROW);
    expect(ev.keep).toBe(true);
    const lead = toWaLead(WA_ROW, ev as { adjust: number; reasons: string[] });
    expect(lead.sourceKey).toBe('childcare:wa:531493');
    expect(lead.name).toBe('Harrah Community Christian School');
    expect(lead.legalName).toBe('Harrah Community Christian School INC'); // titleCase keeps acronyms as-is
    expect(lead.location).toBe('Harrah, WA');
    expect(lead.email).toBe('mwegmuller@aol.com');
    // Free mail: kept as the contact, but this source sets no domain.
    expect(lead.domain).toBeUndefined();
    expect(lead.phone).toBeNull(); // the dataset omits the phone on most rows
    expect(lead.contactName).toBe('MARIE WEGMULLER');
    expect(lead.description).toBe(
      'Listed in the Washington State Department of Children, Youth & Families licensing data as a licensed child care center, based in Harrah, WA.',
    );
  });
  it('labels each in-scope facility type', () => {
    const label = (t: string) => {
      const row = { ...WA_ROW, facilitytypegeneric: t };
      const ev = evaluateWaRow(row);
      expect(ev.keep).toBe(true);
      return toWaLead(row, ev as { adjust: number; reasons: string[] }).typeLabel;
    };
    expect(label('CHILD CARE CENTER')).toBe('licensed child care center');
    expect(label('SCHOOL-AGE PROGRAM')).toBe('licensed school-age child care program');
    expect(label('OUTDOOR NATURE BASED PROGRAM')).toBe('licensed outdoor nature-based child care program');
    expect(Object.keys(WA_TYPE_LABEL).length).toBe(3);
  });
  it('rejects inactive rows, unknown types, and the big multi-site operators', () => {
    const reason = (o: Record<string, string>) => {
      const ev = evaluateWaRow({ ...WA_ROW, ...o });
      expect(ev.keep).toBe(false);
      return (ev as { reason: string }).reason;
    };
    expect(reason({ latestoperatingstatus: 'Not Active' })).toMatch(/not active/);
    expect(reason({ facilitytypegeneric: 'FOSTER HOME' })).toMatch(/not in scope/);
    expect(reason({ doingbusinessas: '', providername: '' })).toMatch(/no provider name/);
    expect(reason({ doingbusinessas: 'YMCA OF GREATER SEATTLE - LAKE CITY' })).toMatch(/multi-site/);
    expect(reason({ doingbusinessas: 'RIGHT AT SCHOOL AT HAZELWOOD ELEMENTARY' })).toMatch(/multi-site/);
    expect(reason({ doingbusinessas: 'BOYS & GIRLS CLUB OF KING COUNTY' })).toMatch(/multi-site/);
    expect(reason({ primarycontactemail: '', primarycontactphonenumber: '' })).toMatch(/no contact detail/);
  });
  it('falls back through the id columns', () => {
    expect(waLicenseId(WA_ROW)).toBe('531493');
    expect(waLicenseId({ ...WA_ROW, sspsprovidernumber: '' })).toBe('558002');
    expect(waLicenseId({ sspsprovidernumber: '', famlinkid: '', wacompassid: 'abc' })).toBe('ABC');
    expect(waLicenseId({})).toBe('');
    const ev = evaluateWaRow({ ...WA_ROW, sspsprovidernumber: '', famlinkid: '', wacompassid: '' });
    expect(ev.keep).toBe(false);
    expect((ev as { reason: string }).reason).toMatch(/no provider id/);
  });
});

describe('childcare: Pennsylvania DHS parser', () => {
  it('keeps a certified family child care home with the PA wording', () => {
    const ev = evaluatePaRow(PA_ROW);
    expect(ev.keep).toBe(true);
    const lead = toPaLead(PA_ROW, ev as { adjust: number; reasons: string[] });
    expect(lead.sourceKey).toBe('childcare:pa:103292743-0001');
    expect(lead.name).toBe('Valerie Davis');
    expect(lead.legalName).toBeNull(); // identical to the facility name
    expect(lead.location).toBe('York, PA');
    expect(lead.phone).toBe('(717) 683-7468');
    expect(lead.email).toBe('peachesvlj@yahoo.com');
    expect(lead.description).toBe(
      'Listed in the Pennsylvania Department of Human Services child care provider data as a certified family child care home, based in York, PA.',
    );
    expect(lead.signalDetail).toContain('certificate CER-00243752');
    expect(lead.signalDetail).toContain('STAR 2');
    expect(lead.signalDetail).toContain('capacity 6');
  });
  it('labels each in-scope provider type and skips "Other"', () => {
    const label = (t: string) => {
      const row = { ...PA_ROW, provider_type: t };
      const ev = evaluatePaRow(row);
      expect(ev.keep).toBe(true);
      return toPaLead(row, ev as { adjust: number; reasons: string[] }).typeLabel;
    };
    expect(label('Child Care Center')).toBe('certified child care center');
    expect(label('Family Child Care Home')).toBe('certified family child care home');
    expect(label('Group Child Care Home')).toBe('certified group child care home');
    const ev = evaluatePaRow({ ...PA_ROW, provider_type: 'Other' });
    expect(ev.keep).toBe(false);
    expect((ev as { reason: string }).reason).toMatch(/not in scope/);
  });
  it('keeps the legal entity only when it differs, and omits an N/A certificate', () => {
    const row = { ...PA_ROW, legal_entity_name: 'KID BIZ LLC', facility_name: 'KID BIZ/SOUTH STRABANE', license_number: 'N/A', capacity: 'N/A', star_level: 'No STAR Level' };
    const ev = evaluatePaRow(row);
    const lead = toPaLead(row, ev as { adjust: number; reasons: string[] });
    expect(lead.legalName).toBe('Kid Biz LLC');
    expect(lead.signalDetail).not.toContain('N/A');
    expect(lead.signalDetail).not.toContain('capacity');
  });
  it('builds the id from mpi_id + location when the index is absent', () => {
    expect(paLicenseId(PA_ROW)).toBe('103292743-0001');
    expect(paLicenseId({ mpi_id: '1', mpi_location_id: '2' })).toBe('1-2');
    expect(paLicenseId({ mpi_id: '1' })).toBe('1');
    expect(paLicenseId({})).toBe('');
  });
});

describe('childcare leads through registryLeadRow', () => {
  const NOW = '2026-09-24T12:00:00.000Z';
  it('a business-domain email becomes a found contact WITH a domain', () => {
    const ev = evaluateTxRow(TX_ROW) as { adjust: number; reasons: string[] };
    const { email, domain, fields } = registryLeadRow(toTxLead(TX_ROW, ev), childcare, NOW);
    expect(email).toBe('director@sproutstartacademy.com');
    expect(domain).toBe('sproutstartacademy.com');
    expect(fields.contact_status).toBe('found');
    expect(fields.contact_email).toBe('director@sproutstartacademy.com');
    // US lead: never on the international hold.
    expect(fields.region_blocked).toBe(false);
    expect(fields.signals.intlHold).toBeUndefined();
  });
  it('THE FREE-MAIL RULE: the email is kept as the contact but no domain is set', () => {
    const ev = evaluatePaRow(PA_ROW) as { adjust: number; reasons: string[] };
    const { email, domain, fields } = registryLeadRow(toPaLead(PA_ROW, ev), childcare, NOW);
    expect(email).toBe('peachesvlj@yahoo.com');
    expect(domain).toBeNull();
    expect(fields.domain).toBeNull();
    expect(fields.contact_status).toBe('found');
    expect(fields.contact_email).toBe('peachesvlj@yahoo.com');
    expect(fields.region_blocked).toBe(false);
  });
  it('a lead with no email at all stays unenriched for website discovery', () => {
    const row = { ...TX_ROW, email_address: '', website_address: '' };
    const ev = evaluateTxRow(row) as { adjust: number; reasons: string[] };
    const { email, domain, fields } = registryLeadRow(toTxLead(row, ev), childcare, NOW);
    expect(email).toBeNull();
    expect(domain).toBeNull();
    expect(fields.contact_status).toBeUndefined();
    expect(fields.signals.registry.phone).toBe('(713) 534-1406');
  });
  it('source keys are namespaced per state so a licence number cannot collide', () => {
    const ids = [
      toTxLead(TX_ROW, { adjust: 0, reasons: [] }).sourceKey,
      toWaLead(WA_ROW, { adjust: 0, reasons: [] }).sourceKey,
      toPaLead(PA_ROW, { adjust: 0, reasons: [] }).sourceKey,
    ];
    expect(ids).toEqual(['childcare:tx:1572561', 'childcare:wa:531493', 'childcare:pa:103292743-0001']);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.startsWith('childcare:')).toBe(true);
    // Same number in two states, still distinct.
    const a = toTxLead({ ...TX_ROW, operation_number: '5' }, { adjust: 0, reasons: [] }).sourceKey;
    const b = toPaLead({ ...PA_ROW, master_provider_index: '5' }, { adjust: 0, reasons: [] }).sourceKey;
    expect(a).not.toBe(b);
  });
  it('the scored description only ever says what the licensing data supports', () => {
    const ev = evaluateWaRow(WA_ROW) as { adjust: number; reasons: string[] };
    const { fields } = registryLeadRow(toWaLead(WA_ROW, ev), childcare, NOW);
    expect(fields.description).toMatch(/^Listed in the Washington State Department of Children, Youth & Families licensing data/);
    // No capacity, staffing, enrolment or inspection claim leaks into the
    // draft-visible text. Checked on the part AFTER the registry name, because
    // "Department of Children, Youth & Families" is itself the registry's name.
    const claim = fields.description.split(' as a ')[1];
    expect(claim).toBe('licensed child care center, based in Harrah, WA.');
    expect(claim).not.toMatch(/capacity|staff|enrol|inspect|child(ren)?'s|ratio/i);
    // The administrator's name stays out of the description (registry meta only).
    expect(fields.description).not.toContain('MARIE');
    expect(fields.signals.registry.contactName).toBe('MARIE WEGMULLER');
  });
});
