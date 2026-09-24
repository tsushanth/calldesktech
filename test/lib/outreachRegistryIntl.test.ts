import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  INTL_HOLD_REASON, NEVER_RELEASE_COUNTRIES, isNeverReleasable, intlCountry, decideRelease,
  cityCountry, formatIntlPhone, formatUsPhone,
} from '@/lib/outreach/discovery/registryCommon';
import { isFreeMail } from '@/lib/outreach/discovery/freightFmcsa';
import { detectDraftLanguage } from '@/lib/outreach/language';
import {
  toRgeRow, evaluateRgeRow, toRgeLead, parseRgeDate, sirenOf, rgeSourceKey,
  parseRgePage, rgeFirstPageUrl, findRgeCandidates, isFrenchPostcode, type RgePage,
} from '@/lib/outreach/discovery/frRgeRegistry';
import {
  toCqcRow, evaluateCqcRow, toCqcLead, cqcTown, cqcDomain, cqcSourceKey, isUkCorporateName,
  findCqcCandidates, CQC_COL, CQC_REQUIRED_COLUMNS, type CqcRow,
} from '@/lib/outreach/discovery/ukCqcDirectory';
import {
  toDvsaRow, evaluateDvsaRow, toDvsaLead, dvsaTown, dvsaSourceKey, dvsaRegionUrl,
  findDvsaCandidates, DVSA_REGIONS, DVSA_COL, type DvsaRow,
} from '@/lib/outreach/discovery/ukDvsaOperators';
import {
  toBrregRow, evaluateBrregRow, toBrregLead, brregSourceKey, brregDomain, brregClassesFor,
  brregSupportsVertical, parseBrregPage, brregQueryUrl, findBrregCandidates,
  BRREG_NACE, BRREG_ORG_FORMS, BRREG_PAGE_CAP, BRREG_DEFAULT_DEADLINE_MS, type BrregPage,
} from '@/lib/outreach/discovery/noBrregEnheter';
import { homeservices, dental, freight, towing } from '@/lib/outreach/products';

const NOW = new Date('2026-09-24T12:00:00Z');
const keep = <T>(ev: { keep: boolean } | T) => {
  expect((ev as { keep: boolean }).keep, JSON.stringify(ev)).toBe(true);
  return ev as T & { keep: true; adjust: number; reasons: string[] };
};

afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
describe('international hold primitives', () => {
  it('treats only a real non-US two-letter code as international', () => {
    expect(intlCountry('FR')).toBe('FR');
    expect(intlCountry('no')).toBe('NO');
    expect(intlCountry('US')).toBeNull();
    expect(intlCountry('us')).toBeNull();
    expect(intlCountry(null)).toBeNull();
    expect(intlCountry('')).toBeNull();
    expect(intlCountry('USA')).toBeNull();
  });

  it('never lets DE, AT, CH or LI be released', () => {
    expect([...NEVER_RELEASE_COUNTRIES].sort()).toEqual(['AT', 'CH', 'DE', 'LI']);
    for (const c of ['DE', 'AT', 'CH', 'LI', 'de', ' ch ']) expect(isNeverReleasable(c)).toBe(true);
    for (const c of ['FR', 'GB', 'NO', 'BR', 'MX', '', null]) expect(isNeverReleasable(c)).toBe(false);
  });

  it('writes the location as "<Town>, <CC>", the same shape the US sources use', () => {
    expect(cityCountry('LYON', 'FR')).toBe('Lyon, FR');
    expect(cityCountry('bergen', 'no')).toBe('Bergen, NO');
    expect(cityCountry(null, 'GB')).toBe('GB');
    expect(cityCountry('London', null)).toBe('London');
  });

  it('keeps a foreign phone as published, and rejects junk', () => {
    expect(formatIntlPhone('06 37 51 96 32')).toBe('06 37 51 96 32');
    expect(formatIntlPhone('+47 45 63 24 53')).toBe('+47 45 63 24 53');
    expect(formatIntlPhone('2073770990')).toBe('2073770990');
    expect(formatIntlPhone('n/a')).toBeNull();
    expect(formatIntlPhone('123')).toBeNull();
    expect(formatIntlPhone(null)).toBeNull();
    // The US formatter is untouched: it still only accepts 10 digits, which is why
    // the international sources need their own formatter rather than reusing it.
    expect(formatUsPhone('55 12 34 56')).toBeNull();
    expect(formatUsPhone('020 7377 0990')).toBeNull();
    expect(formatUsPhone('(509) 455-8622')).toBe('(509) 455-8622');
  });

  it('adds the foreign consumer ISPs to the free-mail rule without widening it for US .com leads', () => {
    for (const e of ['a@orange.fr', 'a@wanadoo.fr', 'a@free.fr', 'a@sfr.fr', 'a@laposte.fr', 'a@online.no', 'a@frisurf.no', 'a@start.no', 'a@blueyonder.co.uk', 'a@btinternet.com', 'a@virginmedia.com', 'a@talktalk.net', 'a@googlemail.com', 'a@uol.com.br']) {
      expect(isFreeMail(e), e).toBe(true);
    }
    // Still free-mail, as before.
    for (const e of ['a@gmail.com', 'a@aol.com', 'a@hotmail.com']) expect(isFreeMail(e)).toBe(true);
    // Real business domains that a careless pattern would have swallowed.
    for (const e of ['a@free.com', 'a@online.net', 'a@start.com', 'a@ig.com', 'a@terra.com', 'a@orange.co', 'a@example.fr', 'a@plumber.no', 'a@dentist.co.uk']) {
      expect(isFreeMail(e), e).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('draft language from a "<Town>, <CC>" location', () => {
  it('resolves FR, GB and NO sensibly', () => {
    expect(detectDraftLanguage('Lyon, FR')).toEqual({ code: 'fr', name: 'French' });
    expect(detectDraftLanguage('Bergen, NO')).toEqual({ code: 'no', name: 'Norwegian' });
    // The UK is English, which is the default, expressed as "no override".
    expect(detectDraftLanguage('London, GB')).toBeNull();
    expect(detectDraftLanguage('Dublin, IE')).toBeNull();
    expect(detectDraftLanguage('São Paulo, BR')).toEqual({ code: 'pt', name: 'Portuguese' });
    expect(detectDraftLanguage('Monterrey, MX')).toEqual({ code: 'es', name: 'Spanish' });
    // Country names still work, and Norway is now among them.
    expect(detectDraftLanguage('Oslo, Norway')).toEqual({ code: 'no', name: 'Norwegian' });
    expect(detectDraftLanguage('Paris, France')).toEqual({ code: 'fr', name: 'French' });
  });

  it('never mistakes a US state code for a country code', () => {
    // DE is Delaware, IN Indiana, OR Oregon, LA Louisiana, MS Mississippi.
    for (const loc of ['Dover, DE', 'Indianapolis, IN', 'Portland, OR', 'New Orleans, LA', 'Jackson, MS', 'Austin, TX', 'Richmond, VA']) {
      expect(detectDraftLanguage(loc), loc).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// France: ADEME RGE contractor register
// ---------------------------------------------------------------------------
const RGE_RAW: Record<string, unknown> = {
  siret: '48774909500021',
  nom_entreprise: 'SARL CHAUFFAGE DUPONT',
  adresse: '113 BOULEVARD DE LAMASQUERE',
  code_postal: '69003',
  commune: 'LYON',
  telephone: '05 34 46 19 48',
  email: 'contact@chauffage-dupont.fr',
  site_internet: 'http://www.chauffage-dupont.fr',
  code_qualification: '2',
  nom_qualification: 'QualiPAC Chauffage',
  domaine: 'Pompe à chaleur : chauffage',
  meta_domaine: "Installations d'énergies renouvelables",
  organisme: 'qualit-enr',
  lien_date_fin: '2099-01-01',
};

describe('France RGE contractor register', () => {
  it('parses a row and keeps a qualified heat-pump installer on hold as a French lead', () => {
    const row = toRgeRow(RGE_RAW);
    expect(row.siret).toBe('48774909500021');
    expect(row.commune).toBe('LYON');
    const ev = keep(evaluateRgeRow(row, NOW));
    const lead = toRgeLead(row, ev);
    expect(lead.sourceKey).toBe('homeservices:fr:487749095');
    expect(lead.country).toBe('FR');
    expect(lead.state).toBe('FR');
    expect(lead.location).toBe('Lyon, FR');
    expect(lead.email).toBe('contact@chauffage-dupont.fr');
    expect(lead.phone).toBe('05 34 46 19 48');
    expect(lead.licenseId).toBe('48774909500021');
    expect(lead.description).toBe('Listed in the French RGE (Reconnu Garant de l’Environnement) contractor register as a heat-pump installer, based in Lyon, FR.');
    // The required wording, verbatim.
    expect(lead.description).toContain('listed in the French RGE (Reconnu Garant de l’Environnement) contractor register'.replace('listed', 'Listed'));
    expect(detectDraftLanguage(lead.location)).toEqual({ code: 'fr', name: 'French' });
  });

  it('does not use a French free-mail address as the contact', () => {
    const row = toRgeRow({ ...RGE_RAW, email: 'dupont@orange.fr' });
    const ev = keep(evaluateRgeRow(row, NOW));
    const lead = toRgeLead(row, ev);
    expect(lead.email).toBeNull();
    expect(lead.contactSourceUrl).toBeNull();
    expect(ev.reasons.join(' ')).toMatch(/free-mail address/);
  });

  it('rejects study, audit and architect qualifications, expired ones, and the national installers', () => {
    const bad = (o: Record<string, unknown>) => evaluateRgeRow(toRgeRow({ ...RGE_RAW, ...o }), NOW);
    expect(bad({ domaine: 'Audit énergétique Maison individuelle' })).toMatchObject({ keep: false, reason: 'study/audit/architect qualification, not an installation trade' });
    expect(bad({ domaine: 'Architecte' })).toMatchObject({ keep: false, reason: 'study/audit/architect qualification, not an installation trade' });
    expect(bad({ domaine: 'Etude thermique reglementaire' })).toMatchObject({ keep: false, reason: 'study/audit/architect qualification, not an installation trade' });
    expect(bad({ domaine: 'Commisionnement' })).toMatchObject({ keep: false, reason: 'study/audit/architect qualification, not an installation trade' });
    expect(bad({ lien_date_fin: '2026-01-01' })).toMatchObject({ keep: false, reason: 'qualification expired' });
    expect(bad({ nom_entreprise: 'ENGIE HOME SERVICES' })).toMatchObject({ keep: false, reason: 'national installer, utility or retail chain name' });
    expect(bad({ nom_entreprise: 'LEROY MERLIN FRANCE' })).toMatchObject({ keep: false, reason: 'national installer, utility or retail chain name' });
    expect(bad({ siret: '487749095' })).toMatchObject({ keep: false, reason: 'no valid SIRET' });
    expect(bad({ commune: '' })).toMatchObject({ keep: false, reason: 'no commune' });
    expect(bad({ domaine: 'Forage géothermique' })).toMatchObject({ keep: false });
  });

  it('refuses the foreign companies the register also lists', () => {
    // A real row the live dry run surfaced: a Portuguese joinery qualified to work
    // in France, with a Portuguese commune, postcode "00000" and a placeholder
    // SIREN. Ingesting it as French would give it the wrong location and a French
    // draft.
    expect(evaluateRgeRow(toRgeRow({
      ...RGE_RAW, siret: '00000000085896', nom_entreprise: 'CAIXIAVE INDUSTRIA DE CAIXILHARIA',
      commune: 'RIBEIRAO', code_postal: '00000', email: 'sonia.conde@caixiave.pt',
      domaine: 'Fenêtres, volets, portes donnant sur l\'extérieur',
    }), NOW)).toMatchObject({ keep: false, reason: 'postcode is not a French one (foreign establishment or placeholder row)' });
    // The postcode is the test, so a real French one with a placeholder SIREN is
    // caught by the SIREN check instead.
    expect(evaluateRgeRow(toRgeRow({ ...RGE_RAW, siret: '00000000012345' }), NOW))
      .toMatchObject({ keep: false, reason: 'placeholder SIREN of all zeroes' });
    // French metropolitan and overseas postcodes, and the ones that are not.
    for (const cp of ['01000', '69003', '75001', '98800', '97400']) expect(isFrenchPostcode(cp), cp).toBe(true);
    for (const cp of ['00000', '00123', '4760', '1234-567', '', null]) expect(isFrenchPostcode(cp), String(cp)).toBe(false);
  });

  it('scores a sole trader down and a company up', () => {
    const sole = keep(evaluateRgeRow(toRgeRow({ ...RGE_RAW, nom_entreprise: 'M DUPONT JEAN' }), NOW));
    expect(sole.reasons.join(' ')).toMatch(/entreprise individuelle \/ sole trader/);
    const co = keep(evaluateRgeRow(toRgeRow(RGE_RAW), NOW));
    expect(co.reasons.join(' ')).toMatch(/registered as a French company/);
    expect(co.adjust).toBeGreaterThan(sole.adjust);
  });

  it('parses dates, SIRENs and keys', () => {
    expect(parseRgeDate('2099-01-01')?.getUTCFullYear()).toBe(2099);
    expect(parseRgeDate('nope')).toBeNull();
    expect(parseRgeDate(null)).toBeNull();
    expect(sirenOf('48774909500021')).toBe('487749095');
    expect(rgeSourceKey('487 749 095 00021')).toBe('homeservices:fr:487749095');
  });

  it('asks for email-bearing rows sorted by siret, which is what makes the dedupe work', () => {
    const url = rgeFirstPageUrl({ pageSize: 500 });
    expect(url).toContain('email_exists=true');
    expect(url).toContain('sort=siret');
    expect(url).toContain('size=500');
    expect(url).toContain('select=siret');
  });

  it('parses a cursor page and rejects a response with no results array', () => {
    expect(parseRgePage({ total: 5, next: 'http://x', results: [] })).toEqual({ total: 5, next: 'http://x', results: [] });
    expect(parseRgePage({ total: 5, results: [] }).next).toBeNull();
    expect(() => parseRgePage({ total: 5 })).toThrow(/no results array/);
  });

  it('collapses one business\'s many qualifications into a single lead, keeping the best-scoring one', async () => {
    // Same SIREN, three qualifications (rows arrive adjacent because of sort=siret),
    // then a second business.
    const pages: RgePage[] = [{
      total: 4,
      next: null,
      results: [
        { ...RGE_RAW, domaine: 'Isolation des combles perdus', nom_entreprise: 'DUPONT ET FILS', code_qualification: '9' },
        { ...RGE_RAW, nom_entreprise: 'DUPONT ET FILS', siret: '48774909500048' }, // heat pump, other establishment, same SIREN
        { ...RGE_RAW, domaine: 'Etude ACV', nom_entreprise: 'DUPONT ET FILS' },
        { ...RGE_RAW, siret: '52233445500011', nom_entreprise: 'SAS TOITURE MARTIN', commune: 'NANTES', domaine: 'Isolation des toitures terrasses ou des toitures par l\'extérieur' },
      ],
    }];
    const res = await findRgeCandidates(100, { now: NOW, pagesOverride: pages });
    expect(res.errors).toEqual([]);
    expect(res.scanned).toBe(4);
    expect(res.candidates.map((c) => c.sourceKey)).toEqual(['homeservices:fr:487749095', 'homeservices:fr:522334455']);
    // Every candidate carries the country, so every one will be held.
    expect(res.candidates.every((c) => c.country === 'FR')).toBe(true);
    expect(res.candidates[1].location).toBe('Nantes, FR');
    expect(res.rejected['duplicate SIREN']).toBe(1); // the Etude ACV row
  });

  it('skips a business that is already a lead, and reports an API failure instead of throwing', async () => {
    const pages: RgePage[] = [{ total: 2, next: null, results: [RGE_RAW] }];
    const res = await findRgeCandidates(10, { now: NOW, pagesOverride: pages, isKnown: (k) => k === 'homeservices:fr:487749095' });
    expect(res.candidates).toEqual([]);
    expect(res.rejected['already known']).toBe(1);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const failed = await findRgeCandidates(10, { now: NOW });
    expect(failed.candidates).toEqual([]);
    expect(failed.errors.join(' ')).toMatch(/fr rge:.*503/);
  });
});

// ---------------------------------------------------------------------------
// United Kingdom: CQC directory
// ---------------------------------------------------------------------------
const cqcRaw = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  [CQC_COL.name]: 'Square Mile Dental Centre',
  [CQC_COL.alsoKnownAs]: '',
  [CQC_COL.address]: '7-9 White Kennet Street,London',
  [CQC_COL.postcode]: 'E1 7BS',
  [CQC_COL.phone]: '2073770990',
  [CQC_COL.website]: 'https://www.squaremiledental.co.uk',
  [CQC_COL.serviceTypes]: 'Dentist',
  [CQC_COL.provider]: 'Square Mile Dental Centre Limited',
  [CQC_COL.localAuthority]: 'City of London',
  [CQC_COL.region]: 'London',
  [CQC_COL.locationUrl]: 'https://www.cqc.org.uk/location/1-10552899555',
  [CQC_COL.locationId]: '1-10552899555',
  [CQC_COL.providerId]: '1-10006912129',
  ...over,
});

describe('UK CQC directory', () => {
  it('parses a dentist row and keeps it on hold as a GB lead, with the register website carried over', () => {
    const row = toCqcRow(cqcRaw());
    expect(row.serviceTypes).toEqual(['Dentist']);
    const ev = keep(evaluateCqcRow(row, 'dental'));
    const lead = toCqcLead(row, 'dental', ev);
    expect(lead.sourceKey).toBe('dental:gb-cqc:1-10552899555');
    expect(lead.country).toBe('GB');
    expect(lead.location).toBe('London, GB');
    expect(lead.description).toBe('Listed in the Care Quality Commission directory of registered locations as a registered dental practice, based in London, GB.');
    // No email in the file at all; the published website is handed to enrichment.
    expect(lead.email).toBeNull();
    expect(lead.domain).toBe('squaremiledental.co.uk');
    expect(lead.phone).toBe('2073770990');
    expect(lead.legalName).toBe('Square Mile Dental Centre Limited');
    // The UK draft stays in English.
    expect(detectDraftLanguage(lead.location)).toBeNull();
  });

  it('keeps a homecare agency for the homecare vertical only', () => {
    const row = toCqcRow(cqcRaw({ [CQC_COL.serviceTypes]: 'Homecare agencies|Supported living', [CQC_COL.name]: 'Acme Care At Home', [CQC_COL.provider]: 'Acme Care Services Ltd', [CQC_COL.locationId]: '1-222' }));
    const ev = keep(evaluateCqcRow(row, 'homecare'));
    expect(toCqcLead(row, 'homecare', ev).description).toMatch(/registered domiciliary \(home\) care agency/);
    expect(evaluateCqcRow(row, 'dental')).toMatchObject({ keep: false, reason: 'service type is not dental' });
    expect(evaluateCqcRow(toCqcRow(cqcRaw()), 'homecare')).toMatchObject({ keep: false, reason: 'service type is not homecare' });
  });

  it('applies the PECR filter: corporate providers in, individuals and partnerships out', () => {
    for (const n of ['Square Mile Dental Centre Limited', 'Acme Care Ltd', 'Bright Smiles PLC', 'Northern Dental LLP', 'Community Care CIC', 'Dr A Patel Ltd']) {
      expect(isUkCorporateName(n), n).toBe(true);
    }
    for (const n of ['Mr A Smith', 'Dr A Patel', 'The Partners of Elm Street Surgery', 'Elm Street Dental Partnership', 'Jane Doe', '']) {
      expect(isUkCorporateName(n), n).toBe(false);
    }
    expect(evaluateCqcRow(toCqcRow(cqcRaw({ [CQC_COL.provider]: 'Elm Street Dental Partnership' })), 'dental'))
      .toMatchObject({ keep: false, reason: 'provider is an individual, sole trader or partnership (PECR consent required)' });
    expect(evaluateCqcRow(toCqcRow(cqcRaw({ [CQC_COL.provider]: 'Jane Doe' })), 'dental'))
      .toMatchObject({ keep: false, reason: 'provider name carries no corporate legal form (PECR consent required)' });
  });

  it('rejects NHS bodies, councils and the national chains', () => {
    for (const provider of ['Leeds Teaching Hospitals NHS Trust', 'Birmingham City Council', 'Mydentist Limited', 'Bupa Dental Care Limited', 'Bluebird Care Ltd', 'Home Instead Senior Care Ltd']) {
      expect(evaluateCqcRow(toCqcRow(cqcRaw({ [CQC_COL.provider]: provider })), 'dental'), provider)
        .toMatchObject({ keep: false, reason: 'NHS body, local authority or national chain' });
    }
  });

  it('pulls the town out of the run-together address, and the domain out of the website', () => {
    expect(cqcTown(toCqcRow(cqcRaw()))).toBe('London');
    expect(cqcTown(toCqcRow(cqcRaw({ [CQC_COL.address]: '12 High Street' })))).toBe('City of London');
    expect(cqcTown(toCqcRow(cqcRaw({ [CQC_COL.address]: '', [CQC_COL.localAuthority]: '' })))).toBeNull();
    expect(cqcDomain('https://www.example.co.uk/about')).toBe('example.co.uk');
    expect(cqcDomain('example.co.uk')).toBe('example.co.uk');
    expect(cqcDomain('')).toBeNull();
    expect(cqcDomain('not a url at all')).toBeNull();
    expect(cqcSourceKey('homecare', '1-abc')).toBe('homecare:gb-cqc:1-ABC');
  });

  it('names the header columns the file actually has, so a layout change fails loudly', () => {
    expect(CQC_REQUIRED_COLUMNS).toEqual(['Name', 'Service types', 'Provider name', 'CQC Location ID (for office use only)']);
  });

  it('streams rows, caps at max, dedupes and skips known locations', async () => {
    const rows: CqcRow[] = [
      toCqcRow(cqcRaw()),
      toCqcRow(cqcRaw()), // exact duplicate location id
      toCqcRow(cqcRaw({ [CQC_COL.locationId]: '1-2', [CQC_COL.name]: 'Elm Dental', [CQC_COL.provider]: 'Elm Dental Ltd' })),
      toCqcRow(cqcRaw({ [CQC_COL.locationId]: '1-3', [CQC_COL.name]: 'Oak Dental', [CQC_COL.provider]: 'Oak Dental Ltd' })),
    ];
    const res = await findCqcCandidates('dental', 2, { rowsOverride: rows });
    expect(res.errors).toEqual([]);
    expect(res.candidates.map((c) => c.licenseId)).toEqual(['1-10552899555', '1-2']);
    expect(res.rejected['duplicate location id']).toBe(1);
    expect(res.candidates.every((c) => c.country === 'GB')).toBe(true);

    const known = await findCqcCandidates('dental', 10, { rowsOverride: [rows[0]], isKnown: (k) => k === 'dental:gb-cqc:1-10552899555' });
    expect(known.candidates).toEqual([]);
    expect(known.rejected['already known']).toBe(1);
  });

  it('reports a download failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const res = await findCqcCandidates('dental', 5, { url: 'https://example.test/cqc.csv' });
    expect(res.candidates).toEqual([]);
    expect(res.errors.join(' ')).toMatch(/uk cqc dental:.*500/);
  });
});

// ---------------------------------------------------------------------------
// United Kingdom: DVSA goods vehicle operator licences
// ---------------------------------------------------------------------------
const dvsaRaw = (over: Partial<Record<string, string>> = {}): Record<string, string> => ({
  [DVSA_COL.region]: 'East of England',
  [DVSA_COL.licence]: 'OF2092798',
  [DVSA_COL.licenceType]: 'Standard National',
  [DVSA_COL.operator]: 'BMS HAULAGE LTD',
  [DVSA_COL.operatorType]: 'Limited Company',
  [DVSA_COL.correspondence]: ' 424 BUSHEY MILL LANE   BUSHEY  GB WD23 2AJ',
  [DVSA_COL.oc]: 'OXHEY LANE UNIT 4   WATFORD  GB WD19 5RF',
  [DVSA_COL.transportManager]: 'ALAN NIVEN',
  [DVSA_COL.vehicles]: '8',
  [DVSA_COL.trailers]: '2',
  [DVSA_COL.director]: 'PERRY ALAN NIVEN (Director)',
  [DVSA_COL.status]: 'lsts_valid',
  [DVSA_COL.companyReg]: '16570052',
  ...over,
});

describe('UK DVSA goods vehicle operator licences', () => {
  it('parses a row and keeps a valid limited-company haulier on hold as a GB lead', () => {
    const row = toDvsaRow(dvsaRaw());
    expect(row.vehicles).toBe(8);
    const ev = keep(evaluateDvsaRow(row));
    const lead = toDvsaLead(row, ev);
    expect(lead.sourceKey).toBe('freight:gb-dvsa:OF2092798');
    expect(lead.country).toBe('GB');
    expect(lead.location).toBe('Watford, GB');
    expect(lead.description).toBe('Listed in the Traffic Commissioners for Great Britain goods vehicle operator licence register as a licensed goods vehicle operator, licensed for 8 vehicles, based in Watford, GB.');
    // The register publishes neither email nor phone.
    expect(lead.email).toBeNull();
    expect(lead.phone).toBeNull();
    // The named director is kept off the draft-visible description.
    expect(lead.contactName).toBe('PERRY ALAN NIVEN (Director)');
    expect(lead.description).not.toMatch(/NIVEN/i);
    expect(ev.reasons.join(' ')).toMatch(/permitted under PECR/);
  });

  it('keeps only valid limited-company licences', () => {
    const bad = (o: Record<string, string>) => evaluateDvsaRow(toDvsaRow(dvsaRaw(o)));
    expect(bad({ [DVSA_COL.operatorType]: 'Sole Trader' })).toMatchObject({ keep: false, reason: 'operator is a Sole Trader, not a limited company (PECR consent required)' });
    expect(bad({ [DVSA_COL.operatorType]: 'Partnership' })).toMatchObject({ keep: false, reason: 'operator is a Partnership, not a limited company (PECR consent required)' });
    expect(bad({ [DVSA_COL.operatorType]: 'Limited Liability Partnership' })).toMatchObject({ keep: false });
    expect(bad({ [DVSA_COL.status]: 'lsts_curtailed' })).toMatchObject({ keep: false, reason: 'licence not valid (lsts_curtailed)' });
    expect(bad({ [DVSA_COL.status]: 'lsts_suspended' })).toMatchObject({ keep: false, reason: 'licence not valid (lsts_suspended)' });
    expect(bad({ [DVSA_COL.operator]: 'TESCO STORES LIMITED' })).toMatchObject({ keep: false, reason: 'supermarket, parcel network, 3PL or public body' });
    expect(bad({ [DVSA_COL.operator]: 'DHL SUPPLY CHAIN LTD' })).toMatchObject({ keep: false, reason: 'supermarket, parcel network, 3PL or public body' });
    expect(bad({ [DVSA_COL.operator]: 'SMITH AND SONS' })).toMatchObject({ keep: false, reason: 'operator name carries no corporate legal form' });
    expect(bad({ [DVSA_COL.licence]: '' })).toMatchObject({ keep: false, reason: 'no licence number' });
  });

  it('prefers a standard licence over a restricted one and demotes a very large fleet', () => {
    const std = keep(evaluateDvsaRow(toDvsaRow(dvsaRaw())));
    const restricted = keep(evaluateDvsaRow(toDvsaRow(dvsaRaw({ [DVSA_COL.licenceType]: 'Restricted' }))));
    expect(std.adjust).toBeGreaterThan(restricted.adjust);
    expect(restricted.reasons.join(' ')).toMatch(/own-account/);
    const intl = keep(evaluateDvsaRow(toDvsaRow(dvsaRaw({ [DVSA_COL.licenceType]: 'Standard International' }))));
    expect(intl.adjust).toBeGreaterThan(std.adjust);
    const huge = keep(evaluateDvsaRow(toDvsaRow(dvsaRaw({ [DVSA_COL.vehicles]: '250' }))));
    expect(huge.reasons.join(' ')).toMatch(/100\+ vehicles/);
    expect(huge.adjust).toBeLessThan(std.adjust);
  });

  it('pulls the town out of the run-together operating-centre address', () => {
    expect(dvsaTown('OXHEY LANE UNIT 4   WATFORD  GB WD19 5RF')).toBe('WATFORD');
    expect(dvsaTown(' 424 BUSHEY MILL LANE   BUSHEY  GB WD23 2AJ')).toBe('BUSHEY');
    expect(dvsaTown('SOME YARD  LEEDS  LS1 1AA')).toBe('LEEDS');
    expect(dvsaTown('')).toBeNull();
    expect(dvsaTown(null)).toBeNull();
  });

  it('names the eight traffic areas and builds each URL', () => {
    expect(DVSA_REGIONS).toHaveLength(8);
    expect(DVSA_REGIONS).toContain('London and the South East of England');
    expect(dvsaRegionUrl('East of England')).toBe('https://content.mgmt.dvsacloud.uk/olcs.app.prod.dvsa.aws/data-gov-uk-export/OLBSLicenceReport_East%20of%20England.csv');
    expect(dvsaSourceKey(' of2092798 ')).toBe('freight:gb-dvsa:OF2092798');
  });

  it('caps at max, dedupes and skips known licences', async () => {
    const rows: DvsaRow[] = [
      toDvsaRow(dvsaRaw()),
      toDvsaRow(dvsaRaw()),
      toDvsaRow(dvsaRaw({ [DVSA_COL.licence]: 'OF2092825', [DVSA_COL.operator]: 'ACME TRANSPORT LTD' })),
    ];
    const res = await findDvsaCandidates(1, { rowsOverride: rows });
    expect(res.candidates.map((c) => c.licenseId)).toEqual(['OF2092798']);
    const all = await findDvsaCandidates(10, { rowsOverride: rows });
    expect(all.candidates).toHaveLength(2);
    expect(all.rejected['duplicate licence number']).toBe(1);
    expect(all.candidates.every((c) => c.country === 'GB')).toBe(true);
  });

  it('lets one traffic area fail without costing the others their rows', async () => {
    const good = 'GeographicRegion,LicenceNumber,LicenceType,OperatorName,OperatorType,CorrespondenceAddress,OCAddress,TransportManager,NumberOfVehiclesAuthorised,NumberOfTrailersAuthorised,DirectorOrPartner,LicenceStatus,CompanyRegNumber\n'
      + Array.from({ length: 600 }, (_, i) => `"Wales",OF30${String(i).padStart(5, '0')},Standard National,"ACME ${i} LTD","Limited Company","A ROAD  CARDIFF  GB CF10 1AA","A ROAD  CARDIFF  GB CF10 1AA","T MANAGER",6,1,"A B (Director)",lsts_valid,123456\n`).join('');
    const fetchMock = vi.fn(async (url: string) => (String(url).includes('Wales')
      ? new Response(good, { status: 200 })
      : new Response('nope', { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);
    const res = await findDvsaCandidates(1000, { regions: ['Scotland', 'Wales'] });
    expect(res.errors.join(' ')).toMatch(/uk dvsa Scotland:.*500/);
    expect(res.candidates).toHaveLength(600);
    expect(res.candidates[0].location).toBe('Cardiff, GB');
  });
});

// ---------------------------------------------------------------------------
// Norway: Enhetsregisteret
// ---------------------------------------------------------------------------
const BRREG_RAW: Record<string, unknown> = {
  organisasjonsnummer: '925820148',
  navn: '7 FJELL TANNLEGE AS',
  organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
  naeringskode1: { kode: '86.230', beskrivelse: 'Tannlegetjenester' },
  antallAnsatte: 5,
  epostadresse: 'post@7fjelltannlege.no',
  hjemmeside: 'www.7fjelltannlege.no',
  telefon: '55 12 34 56',
  forretningsadresse: { land: 'Norge', landkode: 'NO', postnummer: '5147', adresse: ['Folke Bernadottes vei 38'], poststed: 'FYLLINGSDALEN', kommune: 'BERGEN', kommunenummer: '4601' },
  konkurs: false,
  underAvvikling: false,
  registreringsdatoEnhetsregisteret: '2020-10-22',
};
const DENTAL_NACE = BRREG_NACE.find((c) => c.code === '86.230')!;

describe('Norway Enhetsregisteret', () => {
  it('parses an entity and keeps an active AS dental practice on hold as a Norwegian lead', () => {
    const row = toBrregRow(BRREG_RAW);
    expect(row.orgnr).toBe('925820148');
    expect(row.city).toBe('FYLLINGSDALEN');
    expect(row.municipality).toBe('BERGEN');
    expect(row.address).toBe('Folke Bernadottes vei 38');
    const ev = keep(evaluateBrregRow(row, DENTAL_NACE));
    const lead = toBrregLead(row, DENTAL_NACE, ev);
    expect(lead.sourceKey).toBe('dental:no:925820148');
    expect(lead.country).toBe('NO');
    expect(lead.location).toBe('Fyllingsdalen, NO');
    expect(lead.email).toBe('post@7fjelltannlege.no');
    expect(lead.phone).toBe('55 12 34 56');
    expect(lead.description).toBe('Listed in the Norwegian Enhetsregisteret register as a dental practice, based in Fyllingsdalen, NO.');
    expect(detectDraftLanguage(lead.location)).toEqual({ code: 'no', name: 'Norwegian' });
  });

  it('falls back to mobil when there is no switchboard, and to the website when the email is free-mail', () => {
    const row = toBrregRow({ ...BRREG_RAW, telefon: null, mobil: '456 32 452', epostadresse: 'staalknu@frisurf.no' });
    expect(row.phone).toBe('456 32 452');
    const ev = keep(evaluateBrregRow(row, DENTAL_NACE));
    const lead = toBrregLead(row, DENTAL_NACE, ev);
    expect(lead.email).toBeNull();
    expect(lead.domain).toBe('7fjelltannlege.no');
    expect(ev.reasons.join(' ')).toMatch(/free-mail address/);
  });

  it('rejects bankrupt, liquidating, mismatched and institutional entities', () => {
    const bad = (o: Record<string, unknown>) => evaluateBrregRow(toBrregRow({ ...BRREG_RAW, ...o }), DENTAL_NACE);
    expect(bad({ konkurs: true })).toMatchObject({ keep: false, reason: 'bankrupt (konkurs)' });
    expect(bad({ underAvvikling: true })).toMatchObject({ keep: false, reason: 'being wound up (under avvikling)' });
    expect(bad({ underTvangsavviklingEllerTvangsopplosning: true })).toMatchObject({ keep: false, reason: 'being wound up (under avvikling)' });
    expect(bad({ naeringskode1: { kode: '43.210' } })).toMatchObject({ keep: false, reason: 'industry code does not match the vertical' });
    expect(bad({ organisasjonsnummer: '12345' })).toMatchObject({ keep: false, reason: 'no valid organisation number' });
    expect(bad({ forretningsadresse: { postnummer: '5147' } })).toMatchObject({ keep: false, reason: 'no business address' });
    expect(bad({ navn: 'BERGEN KOMMUNE TANNHELSE' })).toMatchObject({ keep: false, reason: 'municipality, health trust or national chain' });
    expect(bad({ navn: 'COLOSSEUM TANNLEGE AS' })).toMatchObject({ keep: false, reason: 'municipality, health trust or national chain' });
  });

  it('flags a sole proprietorship (ENK) as the higher privacy risk and prefers an AS', () => {
    const enk = keep(evaluateBrregRow(toBrregRow({ ...BRREG_RAW, organisasjonsform: { kode: 'ENK' } }), DENTAL_NACE));
    expect(enk.reasons.join(' ')).toMatch(/SOLE PROPRIETORSHIP \(enkeltpersonforetak\).*personal data/);
    const as = keep(evaluateBrregRow(toBrregRow(BRREG_RAW), DENTAL_NACE));
    expect(as.reasons.join(' ')).toMatch(/aksjeselskap/);
    expect(as.adjust).toBeGreaterThan(enk.adjust);
    const nuf = keep(evaluateBrregRow(toBrregRow({ ...BRREG_RAW, organisasjonsform: { kode: 'NUF' } }), DENTAL_NACE));
    expect(nuf.adjust).toBeLessThan(as.adjust);
  });

  it('maps the industry codes to the verticals they belong to', () => {
    expect(brregClassesFor('dental').map((c) => c.code)).toEqual(['86.230']);
    expect(brregClassesFor('homeservices').map((c) => c.code)).toEqual(['43.210', '43.221', '43.222', '43.910', '43.990']);
    expect(brregClassesFor('freight').map((c) => c.code)).toEqual(['49.410']);
    expect(brregClassesFor('towing').map((c) => c.code)).toEqual(['49.420']);
    expect(brregClassesFor('insurance').map((c) => c.code)).toEqual(['66.220']);
    expect(brregClassesFor('homecare').map((c) => c.code)).toEqual(['88.101', '88.102', '87.101']);
    // 43.220 does not exist in the Norwegian NACE variant; 43.221/43.222 do.
    expect(BRREG_NACE.map((c) => c.code)).not.toContain('43.220');
    expect(brregSupportsVertical('bailbonds')).toBe(false);
    expect(brregSupportsVertical('septic')).toBe(false);
    expect(brregSourceKey('freight', '912 345 678')).toBe('freight:no:912345678');
    expect(brregDomain('www.example.no')).toBe('example.no');
    expect(brregDomain('')).toBeNull();
  });

  it('slices every query by legal form so it stays inside the API\'s 10,000-result window', () => {
    expect(BRREG_PAGE_CAP).toBe(10_000);
    expect([...BRREG_ORG_FORMS]).toEqual(['AS', 'ASA', 'NUF', 'DA', 'ANS', 'ENK']);
    const url = brregQueryUrl('49.410', 'AS', 3, 1000);
    expect(url).toContain('naeringskode=49.410');
    expect(url).toContain('organisasjonsform=AS');
    expect(url).toContain('page=3');
    expect(url).toContain('size=1000');
  });

  it('parses an API page and an empty one', () => {
    expect(parseBrregPage({ _embedded: { enheter: [BRREG_RAW] }, page: { totalElements: 6021, totalPages: 7 } }))
      .toMatchObject({ total: 6021, totalPages: 7 });
    expect(parseBrregPage({ page: { totalElements: 0, totalPages: 0 } })).toEqual({ total: 0, totalPages: 0, entities: [] });
  });

  it('walks every code and legal form, dedupes, and warns when a slice exceeds the API window', async () => {
    const seenQueries: string[] = [];
    const fetchPage = async (code: string, form: string, page: number): Promise<BrregPage> => {
      seenQueries.push(`${code}/${form}/${page}`);
      if (form !== 'AS' || page > 0) return { total: 0, totalPages: 0, entities: [] };
      return {
        total: code === '49.410' ? 11_640 : 3,
        totalPages: 1,
        entities: [
          { ...BRREG_RAW, naeringskode1: { kode: code, beskrivelse: 'x' } },
          { ...BRREG_RAW, naeringskode1: { kode: code, beskrivelse: 'x' } }, // duplicate orgnr
        ],
      };
    };
    const dentalRes = await findBrregCandidates('dental', 100, { fetchPage });
    expect(dentalRes.candidates.map((c) => c.sourceKey)).toEqual(['dental:no:925820148']);
    expect(dentalRes.rejected['duplicate organisation number']).toBe(1);
    expect(seenQueries.filter((q) => q.endsWith('/0')).map((q) => q.split('/')[1])).toEqual(['AS', 'ASA', 'NUF', 'DA', 'ANS', 'ENK']);

    const freightRes = await findBrregCandidates('freight', 100, { fetchPage });
    expect(freightRes.errors.join(' ')).toMatch(/11640 results exceeds the API's 10000-result window/);
    // The rows it COULD reach are still returned.
    expect(freightRes.candidates).toHaveLength(1);
  });

  it('stops on an overall deadline rather than hanging when the API throttles', async () => {
    // A live full pass was seen to stall for many minutes once the API started
    // throttling; a per-request timeout does not bound that, because each
    // slow-but-succeeding request resets it.
    expect(BRREG_DEFAULT_DEADLINE_MS).toBe(20 * 60_000);
    let calls = 0;
    const slow = async (code: string): Promise<BrregPage> => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return {
        total: 3,
        totalPages: 1,
        entities: [{ ...BRREG_RAW, organisasjonsnummer: `91234567${calls % 10}`, naeringskode1: { kode: code, beskrivelse: 'x' } }],
      };
    };
    const res = await findBrregCandidates('homeservices', 10_000, { fetchPage: slow, deadlineMs: 60 });
    expect(res.errors.join(' ')).toMatch(/ran out of time after \d+ rows; returning the \d+ candidates found so far/);
    // It gave up early instead of walking all 5 codes x 6 forms.
    expect(calls).toBeLessThan(30);
    // And it still returned what it had.
    expect(res.candidates.length).toBeGreaterThan(0);
  });

  it('reports a missing vertical and a failing slice instead of throwing', async () => {
    const none = await findBrregCandidates('bailbonds', 10, { fetchPage: async () => ({ total: 0, totalPages: 0, entities: [] }) });
    expect(none.candidates).toEqual([]);
    expect(none.errors.join(' ')).toMatch(/no Norwegian industry code for bailbonds/);

    const failing = await findBrregCandidates('dental', 10, { fetchPage: async () => { throw new Error('boom'); } });
    expect(failing.candidates).toEqual([]);
    expect(failing.errors.join(' ')).toMatch(/no brreg 86.230\/AS: boom/);
  });
});

// ---------------------------------------------------------------------------
// The hold itself, end to end through the row builder every source shares.
// ---------------------------------------------------------------------------
describe('the international hold', () => {
  it('stores every non-US source lead region_blocked with signals.intlHold, and leaves US leads alone', async () => {
    const { registryLeadRow: buildRegistryLeadRowForTest } = await import('@/lib/outreach/discovery/pipeline');
    const now = '2026-09-24T12:00:00.000Z';

    const fr = toRgeLead(toRgeRow(RGE_RAW), keep(evaluateRgeRow(toRgeRow(RGE_RAW), NOW)));
    const frRow = buildRegistryLeadRowForTest(fr, homeservices, now);
    expect(frRow.fields.region_blocked).toBe(true);
    expect(frRow.fields.signals.intlHold).toEqual({ country: 'FR', reason: 'international: pending compliance review' });
    expect(frRow.fields.signals.intlHold).toEqual({ country: 'FR', reason: INTL_HOLD_REASON });
    // The email is still found, so the lead is ready the moment France is released.
    expect(frRow.fields.contact_status).toBe('found');
    expect(frRow.fields.location).toBe('Lyon, FR');

    const gbCqc = toCqcLead(toCqcRow(cqcRaw()), 'dental', keep(evaluateCqcRow(toCqcRow(cqcRaw()), 'dental')));
    const gbRow = buildRegistryLeadRowForTest(gbCqc, dental, now);
    expect(gbRow.fields.region_blocked).toBe(true);
    expect(gbRow.fields.signals.intlHold).toEqual({ country: 'GB', reason: INTL_HOLD_REASON });
    // The register's own website is carried through, so enrichment has a head start.
    expect(gbRow.fields.domain).toBe('squaremiledental.co.uk');
    expect(gbRow.fields.contact_status).toBeUndefined();

    const gbDvsa = toDvsaLead(toDvsaRow(dvsaRaw()), keep(evaluateDvsaRow(toDvsaRow(dvsaRaw()))));
    expect(buildRegistryLeadRowForTest(gbDvsa, freight, now).fields.region_blocked).toBe(true);

    const no = toBrregLead(toBrregRow(BRREG_RAW), DENTAL_NACE, keep(evaluateBrregRow(toBrregRow(BRREG_RAW), DENTAL_NACE)));
    const noRow = buildRegistryLeadRowForTest(no, dental, now);
    expect(noRow.fields.region_blocked).toBe(true);
    expect(noRow.fields.signals.intlHold).toEqual({ country: 'NO', reason: INTL_HOLD_REASON });

    // A domestic lead: no country, no hold, no intlHold key at all.
    const us = { ...fr, country: null, sourceKey: 'homeservices:wa:1', location: 'Seattle, WA', state: 'WA' };
    const usRow = buildRegistryLeadRowForTest(us, homeservices, now);
    expect(usRow.fields.region_blocked).toBe(false);
    expect('intlHold' in usRow.fields.signals).toBe(false);
    // And the same for a lead whose country is explicitly US.
    expect(buildRegistryLeadRowForTest({ ...us, country: 'US' }, towing, now).fields.region_blocked).toBe(false);
  });

  it('registers the four international sources for bulk import only', async () => {
    const { BULK_REGISTRY_SOURCE_IDS, bulkRegistrySourcesFor } = await import('@/lib/outreach/discovery/pipeline');
    for (const id of ['fr-rge', 'uk-cqc', 'uk-dvsa', 'no-brreg']) expect(BULK_REGISTRY_SOURCE_IDS).toContain(id);
    expect(bulkRegistrySourcesFor(homeservices)).toContain('fr-rge');
    expect(bulkRegistrySourcesFor(dental)).toContain('uk-cqc');
    expect(bulkRegistrySourcesFor(dental)).toContain('no-brreg');
    expect(bulkRegistrySourcesFor(freight)).toEqual(expect.arrayContaining(['uk-dvsa', 'no-brreg']));
    // The US sources are untouched.
    expect(bulkRegistrySourcesFor(homeservices)).toEqual(expect.arrayContaining(['nyc-dob', 'va-dpor', 'ar-clb']));
  });

  it('refuses to release DE, AT, CH or LI, whatever the caller asks for', () => {
    // decideRelease IS the gate release-country.ts applies before it touches the
    // database, so this is the real rule and not a copy of it.
    for (const c of ['DE', 'AT', 'CH', 'LI', 'de', ' at ']) {
      const d = decideRelease(c);
      expect(d.ok, c).toBe(false);
      expect(d.ok === false && d.reason).toMatch(/can never be released/);
    }
    for (const c of ['US', 'us']) expect(decideRelease(c)).toMatchObject({ ok: false, reason: expect.stringMatching(/not held in the first place/) });
    for (const c of ['FRA', '', 'F', 'F1', null, undefined]) {
      expect(decideRelease(c), String(c)).toMatchObject({ ok: false, reason: expect.stringMatching(/ISO-3166 alpha-2/) });
    }
    for (const c of ['FR', 'gb', ' no ', 'BR', 'MX']) expect(decideRelease(c)).toEqual({ ok: true, country: c.trim().toUpperCase() });
  });
});
