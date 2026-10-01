import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  evaluateNjRow, toNjLead, evaluateMaRow, toMaLead, evaluateCtRow, toCtLead,
  evaluateNyRow, toNyLead, evaluateVtRow, toVtLead, toCapacity, allNeChildcareLeads, fetchSocrataAll, fetchNjRows,
} from '@/lib/outreach/discovery/childcareNortheast';

afterEach(() => vi.restoreAllMocks());

function kept<T>(ev: { keep: boolean }, fn: (e: { adjust: number; reasons: string[] }) => T): T {
  expect(ev.keep).toBe(true);
  return fn(ev as unknown as { adjust: number; reasons: string[] });
}

describe('northeast childcare loaders', () => {
  it('parses MA decimal capacity without inflating it', () => {
    expect(toCapacity('68.00')).toBe(68);
    expect(toCapacity('12')).toBe(12);
    expect(toCapacity('')).toBeNull();
  });

  it('NJ keeps email and phone, skips chains', () => {
    const row = { center_id: '130600262', center_name: 'The Purple Crayon Enrichment Center, LLC', owner: 'The Purple Crayon Enrichment Center, LLC', director: 'Monica Giampa', city: 'Egg Harbor Township', county: 'Atlantic', center_phone: '609-365-8877', center_email: 'Monica@PurpleCrayonEC.com', licensed_capacity: 47 };
    const l = kept(evaluateNjRow(row), (ev) => toNjLead(row, ev));
    expect(l.sourceKey).toBe('childcare:nj:130600262');
    expect(l.email).toBe('monica@purplecrayonec.com');
    expect(l.phone).toBe('(609) 365-8877');
    expect(l.state).toBe('NJ');
    expect(l.contactSourceUrl).toBeTruthy();
    expect(evaluateNjRow({ ...row, center_name: 'Goddard School of Edison' })).toEqual({ keep: false, reason: 'national chain, franchise, or large multi-site operator' });
    expect(evaluateNjRow({ ...row, center_id: '' }).keep).toBe(false);
  });

  it('MA keeps licensed current programs, rejects funded-only, expired and inactive homes', () => {
    const row = { provider_number: 'P-169294', program_name: 'Williamstown Community Preschool, INC', program_city: 'Williamstown', program_phone: '(413) 458-4476', program_type: 'Center-based Care', licensed_funded: 'Licensed', licensed_provider_status: 'Current', licensed_capacity: '68.00' };
    const l = kept(evaluateMaRow(row), (ev) => toMaLead(row, ev));
    expect(l.sourceKey).toBe('childcare:ma:P-169294');
    expect(l.email).toBeNull();
    expect(l.signalDetail).toContain('capacity 68;');
    expect(evaluateMaRow({ ...row, licensed_funded: 'Funded' }).keep).toBe(false);
    expect(evaluateMaRow({ ...row, licensed_provider_status: 'Expired' }).keep).toBe(false);
    expect(evaluateMaRow({ ...row, program_type: 'Family Child Care', regulatory_status: 'Inactive' }).keep).toBe(false);
    expect(evaluateMaRow({ ...row, program_phone: '' }).keep).toBe(false);
  });

  it('CT keeps active homes and centres, skips youth camps and inactive', () => {
    const row = { licensenumber: 'DCFH.48128', name: 'SUSAN THREET-RAKEM', licensetype: 'Family Child Care Home', status: 'ACTIVE', city: 'WEST HAVEN', phone: '(203) 932-3089', regularcapacity: '6' };
    const l = kept(evaluateCtRow(row), (ev) => toCtLead(row, ev));
    expect(l.sourceKey).toBe('childcare:ct:DCFH.48128');
    expect(l.name).toBe('Susan Threet-Rakem');
    expect(l.typeLabel).toBe('licensed family child care home');
    expect(evaluateCtRow({ ...row, licensetype: 'Youth Camp' }).keep).toBe(false);
    expect(evaluateCtRow({ ...row, status: 'INACTIVE' }).keep).toBe(false);
  });

  it('NY honours withheld phones and skips suspended facilities', () => {
    const row = { facility_id: '39871', facility_name: 'Great Neck Community School', program_type: 'DCC', facility_status: 'License', city: 'Great Neck', county: 'Nassau', phone_number: '(516)482-5005', total_capacity: '82' };
    const l = kept(evaluateNyRow(row), (ev) => toNyLead(row, ev));
    expect(l.sourceKey).toBe('childcare:ny:39871');
    expect(l.phone).toBe('(516) 482-5005');
    expect(l.typeLabel).toBe('licensed child care center');
    expect(evaluateNyRow({ ...row, phone_number_omitted: 'Y' })).toEqual({ keep: false, reason: 'no contact detail at all' });
    expect(evaluateNyRow({ ...row, facility_status: 'Suspended' }).keep).toBe(false);
    expect(kept(evaluateNyRow({ ...row, facility_status: 'Registration', program_type: 'SACC' }), (ev) => toNyLead({ ...row, facility_status: 'Registration', program_type: 'SACC' }, ev)).typeLabel).toBe('registered school-age child care program');
  });

  it('VT keeps email and phone, skips inactive', () => {
    const row = { license_id: '32502', provider_name: 'Allen Brook School', provider_town: 'Williston', license_type: 'Licensed Provider', provider_program_type: 'CBCCPP', provider_referral_status: 'Active', phone_number: '(802) 871-6236', email_address: 'egagne@cvsdvt.org', total_licensed_capacity: '30' };
    const l = kept(evaluateVtRow(row), (ev) => toVtLead(row, ev));
    expect(l.email).toBe('egagne@cvsdvt.org');
    expect(l.sourceKey).toBe('childcare:vt:32502');
    expect(evaluateVtRow({ ...row, provider_referral_status: 'Inactive' }).keep).toBe(false);
  });

  it('allNeChildcareLeads dedupes repeated licence rows and honours isKnown (mocked fetch)', async () => {
    const row = { licensenumber: 'DCFH.1', name: 'A Home', licensetype: 'Family Child Care Home', status: 'ACTIVE', city: 'X', phone: '2035550101', regularcapacity: '6' };
    const rows = [row, row, { ...row, licensenumber: 'DCFH.2', name: 'B Home' }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));
    const r = await allNeChildcareLeads('ct', { isKnown: (k) => k === 'childcare:ct:DCFH.2' });
    expect(r.scanned).toBe(3);
    expect(r.candidates.map((c) => c.sourceKey)).toEqual(['childcare:ct:DCFH.1']);
    expect(r.rejected['duplicate licence row']).toBe(1);
    expect(r.rejected['already known']).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('caller-phone policy per state', () => {
  const njRow = { center_id: '1', center_name: 'Cradles To Crayons', owner: 'Smithfield Ejp LLC', city: 'Newark', center_phone: '973-555-0101', center_email: 'info@cradles.org', licensed_capacity: 40 };
  const lead = <T,>(ev: { keep: boolean }, fn: (e: { adjust: number; reasons: string[] }) => T) => kept(ev, fn);

  it('NJ: centre with a business owner keeps its phone, even when its name has no business word', () => {
    expect(lead(evaluateNjRow(njRow), (e) => toNjLead(njRow, e)).callerPhoneExcluded).toBeNull();
    const r = { ...njRow, center_name: 'Little Sprouts', owner: 'Salvation Army' };
    expect(lead(evaluateNjRow(r), (e) => toNjLead(r, e)).callerPhoneExcluded).toBeNull();
  });
  it('NJ: person-named owner on a non-incorporated centre is a sole proprietor; email is kept', () => {
    const r = { ...njRow, center_name: "Carla's Kids", owner: 'Carla Thompson-Stevens' };
    const l = lead(evaluateNjRow(r), (e) => toNjLead(r, e));
    expect(l.callerPhoneExcluded).toBe('sole proprietor');
    expect(l.email).toBe('info@cradles.org');
    const inc = { ...r, center_name: 'Sandpiper School, INC.', owner: 'Barbara Mabrey' };
    expect(lead(evaluateNjRow(inc), (e) => toNjLead(inc, e)).callerPhoneExcluded).toBeNull();
    const dcf = { ...njRow, owner: 'Njdcf Ooe' };
    expect(lead(evaluateNjRow(dcf), (e) => toNjLead(dcf, e)).callerPhoneExcluded).toBeNull();
  });
  it('MA: family child care is home-based, centres are not', () => {
    const home = { provider_number: 'P-1', program_name: 'Strom, Rebecca', program_city: 'Dorchester', program_phone: '(617) 282-1722', program_type: 'Family Child Care', licensed_funded: 'Licensed', licensed_provider_status: 'Current', regulatory_status: 'Active', licensed_capacity: '6.00' };
    const h = lead(evaluateMaRow(home), (e) => toMaLead(home, e));
    expect(h.callerPhoneExcluded).toBe('home-based provider');
    expect(h.name).toBeTruthy();
    const centre = { ...home, provider_number: 'P-2', program_name: 'Little Beginnings', program_type: 'Center-based Care' };
    expect(lead(evaluateMaRow(centre), (e) => toMaLead(centre, e)).callerPhoneExcluded).toBeNull();
    const sole = { ...centre, provider_number: 'P-3', program_name: 'Peanuts Daycare', program_umbrella: 'Linda Bachteler' };
    expect(lead(evaluateMaRow(sole), (e) => toMaLead(sole, e)).callerPhoneExcluded).toBe('sole proprietor');
  });
  it('CT: family and group homes excluded; a centre named like a person-ish phrase is not', () => {
    const home = { licensenumber: 'DCFH.1', name: 'Janet Tolisano', licensetype: 'Family Child Care Home', status: 'ACTIVE', city: 'AVON', phone: '8606730877', regularcapacity: '6' };
    expect(lead(evaluateCtRow(home), (e) => toCtLead(home, e)).callerPhoneExcluded).toBe('home-based provider');
    const grp = { ...home, licensenumber: 'DCGH.1', licensetype: 'Group Child Care Home' };
    expect(lead(evaluateCtRow(grp), (e) => toCtLead(grp, e)).callerPhoneExcluded).toBe('home-based provider');
    for (const name of ['Bright Years Niantic', 'The Nest At Greenfield Hill', 'Shiny Little Stars', 'Cradles To Crayons', 'My Little Rascals Too']) {
      const c = { ...home, licensenumber: 'DCCC.1', licensetype: 'Child Care Center', name };
      expect(lead(evaluateCtRow(c), (e) => toCtLead(c, e)).callerPhoneExcluded, name).toBeNull();
    }
  });
  it('NY: GFDC and FDC are home-based; DCC and SACC are not; centre named after its provider is person-named', () => {
    const base = { facility_id: '9', facility_name: 'Little Hearts', program_type: 'DCC', facility_status: 'License', city: 'Bronx', phone_number: '(718) 555-0100', total_capacity: '30', provider_name: 'Maria Lopez' };
    expect(lead(evaluateNyRow(base), (e) => toNyLead(base, e)).callerPhoneExcluded).toBeNull();
    for (const t of ['GFDC', 'FDC']) {
      const r = { ...base, program_type: t };
      expect(lead(evaluateNyRow(r), (e) => toNyLead(r, e)).callerPhoneExcluded, t).toBe('home-based provider');
    }
    const sacc = { ...base, program_type: 'SACC', facility_name: 'Ester Sweetheart Day Care Center LLC.' };
    expect(lead(evaluateNyRow(sacc), (e) => toNyLead(sacc, e)).callerPhoneExcluded).toBeNull();
    const own = { ...base, facility_name: 'Maria Lopez' };
    expect(lead(evaluateNyRow(own), (e) => toNyLead(own, e)).callerPhoneExcluded).toBe('person-named business');
  });
  it('VT: registered homes lose the phone but keep the email; programs keep both', () => {
    const home = { license_id: '1', provider_name: 'Morin, Teresa', provider_town: 'Eden', license_type: 'Registered Home', provider_program_type: 'Registered FCCH', provider_referral_status: 'Active', phone_number: '(802) 635-7671', email_address: 'teresadmorin@gmail.com', total_licensed_capacity: '6' };
    const h = lead(evaluateVtRow(home), (e) => toVtLead(home, e));
    expect(h.callerPhoneExcluded).toBe('home-based provider');
    expect(h.email).toBe('teresadmorin@gmail.com');
    const prog = { ...home, license_id: '2', provider_name: 'Expanding Minds Early Learning Center LLC', license_type: 'Licensed Provider', provider_program_type: 'CBCCPP' };
    expect(lead(evaluateVtRow(prog), (e) => toVtLead(prog, e)).callerPhoneExcluded).toBeNull();
    const lfcch = { ...prog, license_id: '3', provider_program_type: 'Licensed FCCH' };
    expect(lead(evaluateVtRow(lfcch), (e) => toVtLead(lfcch, e)).callerPhoneExcluded).toBe('home-based provider');
  });
});

describe('pagination and partial data', () => {
  afterEach(() => vi.unstubAllGlobals());
  const def = { host: 'x.example', dataset: 'abcd-efgh', select: 'a', where: '1=1', limit: '2' };

  it('fetchSocrataAll pages with $offset until a short page (no silent $limit truncation)', async () => {
    const all = [1, 2, 3, 4, 5].map((n) => ({ id: String(n) }));
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      const off = Number(u.searchParams.get('$offset')); const lim = Number(u.searchParams.get('$limit'));
      return new Response(JSON.stringify(all.slice(off, off + lim)), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    // limit '2' is clamped to min(limit, 10000) = 2 -> pages of 2
    const rows = await fetchSocrataAll(def);
    expect(rows).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a failing page surfaces as an error result with no candidates (never partial success)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad where', { status: 400 })));
    const r = await allNeChildcareLeads('ct');
    expect(r.candidates).toHaveLength(0);
    expect(r.errors[0]).toMatch(/childcare ct/);
  });

  it('fetchNjRows keeps paging while pages are non-empty, even if a page is shorter than 2000', async () => {
    const pages = [[{ center_id: '1' }, { center_id: '2' }], [{ center_id: '3' }], []];
    let i = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: (pages[i++] ?? []).map((attributes) => ({ attributes })) }), { status: 200 })));
    const rows = await fetchNjRows();
    expect(rows.map((r) => r.center_id)).toEqual(['1', '2', '3']);
  });
});

describe('chain filter', () => {
  it('drops franchise and multi-site brands but keeps an independent centre named with similar words', () => {
    const nj = { center_id: '5', center_name: 'Little Learning Experience Academy', owner: 'A B Learning LLC', city: 'X', center_phone: '2015550100', center_email: 'a@b.org', licensed_capacity: 20 };
    expect(evaluateNjRow(nj).keep).toBe(true);
    expect(evaluateNjRow({ ...nj, center_name: 'Kindercare Learning Center' }).keep).toBe(false);
    expect(evaluateNjRow({ ...nj, owner: 'Bright Horizons Childrens Centers LLC' }).keep).toBe(false);
  });
});
