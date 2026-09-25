import { describe, it, expect } from 'vitest';
import { INTL_HOLD_REASON, decideRelease } from '@/lib/outreach/discovery/registryCommon';
import { isFreeMail } from '@/lib/outreach/discovery/freightFmcsa';
import { detectDraftLanguage } from '@/lib/outreach/language';
import { parseCsv, CsvRowParser } from '@/lib/outreach/discovery/csvStream';
import { makeRowParser } from '@/lib/outreach/discovery/delimitedStream';
import {
  toBrregRow, evaluateBrregRow, toBrregLead, brregClassesFor, brregSupportsVertical,
  brregQueryUrl, splitDateRange, checkBrregCodes, findBrregCandidates,
  BRREG_NACE, BRREG_RETIRED_CODES, BRREG_FULL_RANGE, BRREG_PAGE_CAP,
  type BrregPage, type BrregNaceClass, type BrregDateRange,
} from '@/lib/outreach/discovery/noBrregEnheter';
import {
  toFrFuneralRow, evaluateFrFuneralRow, toFrFuneralLead, frFuneralSourceKey, frFuneralKeyPart,
  parseDataGouvResources, pickLatestCsv, findFrFuneralCandidates,
  FR_FUNERAL_COLUMNS, FR_FUNERAL_REQUIRED,
} from '@/lib/outreach/discovery/frFuneralOperators';
import {
  toQcCpeRow, evaluateQcCpeRow, toQcCpeLead, qcCpeSourceKey, isCanadianPostcode,
  findQcCpeCandidates, QC_CPE_COLUMNS, QC_CPE_REQUIRED,
} from '@/lib/outreach/discovery/qcChildcare';
import {
  toQcLodgingRow, evaluateQcLodgingRow, toQcLodgingLead, qcLodgingSourceKey, qcLodgingLabel,
  qcLodgingDomain, findQcLodgingCandidates, QC_LODGING_FILES, QC_LODGING_COLUMNS, QC_LODGING_REQUIRED,
} from '@/lib/outreach/discovery/qcLodging';
import { QC_COUNTRY, QC_STATE, QC_LICENCE } from '@/lib/outreach/discovery/qcCommon';
import {
  toSgEcdaRow, evaluateSgEcdaRow, toSgEcdaLead, sgEcdaSourceKey, sgEcdaDomain, isSgPostcode,
  parseSgPage, sgEcdaPageUrl, countCentresPerOrg, findSgEcdaCandidates, SgRateLimited,
  SG_MAX_CENTRES_PER_ORG, type SgPage,
} from '@/lib/outreach/discovery/sgEcdaChildcare';
import {
  toEeRow, evaluateEeRow, toEeLead, eeSourceKey, eeDomain, eeDateKey,
  parseZipLocalHeader, JsonObjectSplitter, findEeAgencyCandidates, EE_MIN_EMPLOYEES,
} from '@/lib/outreach/discovery/eeAriregister';
import { calldesk, childcare, funeral, lodging, physio, taxi, accounting, vets, realestate } from '@/lib/outreach/products';

const keep = <T>(ev: { keep: boolean } | T) => {
  expect((ev as { keep: boolean }).keep, JSON.stringify(ev)).toBe(true);
  return ev as T & { keep: true; adjust: number; reasons: string[] };
};
const drop = (ev: { keep: boolean }) => {
  expect(ev.keep, JSON.stringify(ev)).toBe(false);
  return ev as { keep: false; reason: string };
};

// ===========================================================================
describe('semicolon delimited streaming', () => {
  it('keeps the comma default byte-for-byte and adds a semicolon mode', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    // The French funeral file's shape: semicolon separated, quotes used only where
    // a field actually contains one, "" as the escape.
    expect(parseCsv('Raison;Adresse\nSARL X;"""Les Tuilières"""\n', ';'))
      .toEqual([['Raison', 'Adresse'], ['SARL X', '"Les Tuilières"']]);
    // A comma inside a semicolon-separated field is data, not a separator.
    expect(parseCsv('a;b\nx;p, q, r\n', ';')).toEqual([['a', 'b'], ['x', 'p, q, r']]);
    // The Québec shape: every field quoted, and an embedded newline inside quotes.
    expect(parseCsv('"a";"b"\n"CAMPING X";"line1\nline2"\n', ';'))
      .toEqual([['a', 'b'], ['CAMPING X', 'line1\nline2']]);
  });

  it('refuses a separator that would break the quoting rules', () => {
    expect(() => new CsvRowParser('"')).toThrow(/invalid CSV separator/);
    expect(() => new CsvRowParser('\n')).toThrow(/invalid CSV separator/);
    expect(() => new CsvRowParser(';;')).toThrow(/invalid CSV separator/);
  });

  it('wires "semicolon" through makeRowParser', () => {
    const p = makeRowParser('semicolon');
    expect(p.feed('a;b\n')).toEqual([['a', 'b']]);
    expect(makeRowParser('comma').feed('a,b\n')).toEqual([['a', 'b']]);
    expect(makeRowParser('tab').feed('a\tb\n')).toEqual([['a', 'b']]);
  });
});

// ===========================================================================
describe('free-mail recognition for the new countries', () => {
  it('knows the Québec, Estonian and Singaporean consumer ISPs', () => {
    for (const e of [
      'lesptitsflots@globetrotter.net', 'garderie@videotron.ca', 'cpe@bellnet.ca',
      'info@sympatico.ca', 'x@hotmail.ca', 'y@yahoo.ca', 'z@live.ca',
      'a@hot.ee', 'b@mail.ee', 'c@singnet.com.sg',
    ]) expect(isFreeMail(e), e).toBe(true);
    // Real business domains in the same countries must NOT be caught.
    for (const e of [
      'info@garderielesamis.ca', 'contact@cpe-soleil.qc.ca', 'hello@nortal.ee',
      'admin@littlestars.com.sg', 'info@camping-chez-jean.com',
    ]) expect(isFreeMail(e), e).toBe(false);
  });
});

// ===========================================================================
describe('draft language for the new markets', () => {
  it('resolves NO, FR, QC, SG and EE the way each source writes its location', () => {
    expect(detectDraftLanguage('Oslo, NO')).toEqual({ code: 'no', name: 'Norwegian' });
    expect(detectDraftLanguage('Toulouse, FR')).toEqual({ code: 'fr', name: 'French' });
    // Québec is Canadian French, NOT France French — the whole reason the location
    // carries QC rather than CA.
    expect(detectDraftLanguage('Amqui, QC')).toEqual({ code: 'fr-CA', name: 'Canadian French' });
    expect(detectDraftLanguage('Magog, QC')).toEqual({ code: 'fr-CA', name: 'Canadian French' });
    // Singapore and Estonia are English ON PURPOSE (null = the English default).
    expect(detectDraftLanguage('Singapore, SG')).toBeNull();
    expect(detectDraftLanguage('Tallinn, EE')).toBeNull();
    // And "CA" must never be treated as Canada: it is California.
    expect(detectDraftLanguage('Los Angeles, CA')).toBeNull();
  });

  it('lets every new country be released, and still refuses the consent-only ones', () => {
    for (const c of ['NO', 'FR', 'CA', 'SG', 'EE']) expect(decideRelease(c)).toEqual({ ok: true, country: c });
    expect(decideRelease('DE').ok).toBe(false);
  });
});

// ===========================================================================
describe('Norway: the second batch of industry codes', () => {
  const naceFor = (code: string) => BRREG_NACE.find((c) => c.code === code) as BrregNaceClass;

  it('maps each new vertical and the agency audience to a live SN2025 code', () => {
    expect(naceFor('86.950').productId).toBe('physio');
    expect(naceFor('49.320').productId).toBe('taxi');
    expect(naceFor('69.201').productId).toBe('accounting');
    expect(naceFor('75.000').productId).toBe('vets');
    expect(naceFor('68.310').productId).toBe('realestate');
    for (const p of [physio, taxi, accounting, vets, realestate]) expect(brregSupportsVertical(p.id)).toBe(true);
    // The agency audience is the base product, not a vertical.
    expect(brregClassesFor('calldesk').map((c) => c.code).sort())
      .toEqual(['62.100', '62.200', '70.200', '73.110', '82.200']);
    // HVAC and plumbing were already there and stay under homeservices.
    expect(brregClassesFor('homeservices').map((c) => c.code)).toEqual(expect.arrayContaining(['43.221', '43.222']));
  });

  it('names the retired SN2025 codes rather than letting one be re-added silently', () => {
    expect(Object.keys(BRREG_RETIRED_CODES).sort()).toEqual(['43.220', '62.010', '62.020', '70.220']);
    // No retired code is in the live list.
    for (const dead of Object.keys(BRREG_RETIRED_CODES)) {
      expect(BRREG_NACE.some((c) => c.code === dead), dead).toBe(false);
    }
  });

  it('turns a code that returns zero rows into a LOUD warning, not an empty import', async () => {
    const totals: Record<string, number> = { '62.100': 17523, '62.010': 0, '99.999': 0 };
    const dead = await checkBrregCodes(['62.100', '62.010', '99.999'], async (c) => totals[c]);
    expect(dead).toHaveLength(2);
    expect(dead[0]).toMatch(/62\.010 RETURNS ZERO ROWS/);
    // A code we know the replacement for says what it is.
    expect(dead[0]).toMatch(/replaced by 62\.100/);
    // One we do not tells the reader to go and look.
    expect(dead[1]).toMatch(/99\.999 RETURNS ZERO ROWS/);
    expect(dead[1]).toMatch(/current SN2025 code list/);
  });

  it('does not mistake a network failure for a retired code', async () => {
    const dead = await checkBrregCodes(['62.100'], async () => { throw new Error('ECONNRESET'); });
    expect(dead).toEqual([]);
  });

  it('splits an over-cap slice by registration date and walks each half', async () => {
    const nace = naceFor('70.200');
    // The orgnr is salted with the code so each of the five agency codes returns
    // DIFFERENT companies, the way the real API does.
    const rows = (n: number, base: number, code: string) => Array.from({ length: n }, (_, i) => ({
      organisasjonsnummer: String(900000000 + Number(code.replace('.', '')) * 100 + base + i),
      navn: `Konsulent ${code}-${base + i} AS`,
      organisasjonsform: { kode: 'AS' },
      naeringskode1: { kode: code, beskrivelse: 'Bedriftsrådgivning' },
      forretningsadresse: { poststed: 'OSLO', postnummer: '0150', kommune: 'OSLO' },
      epostadresse: `post${base + i}@konsulent${base + i}.no`,
      antallAnsatte: 4,
    }));
    const asked: { range: BrregDateRange; page: number }[] = [];
    const fetchPage = async (code: string, form: string, page: number, range: BrregDateRange): Promise<BrregPage> => {
      asked.push({ range, page });
      if (form !== 'AS') return { total: 0, totalPages: 0, entities: [] };
      // The whole range is over the cap; each half fits.
      if (!range.from && !range.to) return { total: BRREG_PAGE_CAP + 1, totalPages: 1, entities: rows(1, 0, code) };
      return { total: 2, totalPages: 1, entities: rows(2, range.from === '1800-01-01' ? 10 : 20, code) };
    };
    const res = await findBrregCandidates('calldesk', 100, {
      orgForms: ['AS'], pageSize: 1000, fetchPage,
      // Only the one code, so the test is about the split and nothing else.
      checkCodes: false,
    });
    // The unbounded probe, then two dated halves.
    const ranges = asked.map((a) => `${a.range.from ?? '-'}..${a.range.to ?? '-'}`);
    expect(ranges[0]).toBe('-..-');
    expect(ranges.filter((r) => r !== '-..-').length).toBeGreaterThanOrEqual(2);
    // Every agency code is walked as two dated halves of two rows each, and the
    // over-cap probe page itself is never counted (it is split, not read).
    expect(res.candidates.length).toBe(brregClassesFor('calldesk').length * 4);
    // All five codes share the `calldesk:no:<orgnr>` key space, so the key is the
    // company, not the code — every candidate is distinct.
    expect(new Set(res.candidates.map((c) => c.sourceKey)).size).toBe(res.candidates.length);
    for (const c of res.candidates) expect(c.sourceKey).toMatch(/^calldesk:no:\d{9}$/);
    // No "exceeds the window" error, because the split solved it.
    expect(res.errors.filter((e) => /exceeds the API/.test(e))).toEqual([]);
    expect(nace.productId).toBe('calldesk');
  });

  it('gives up loudly when a single day is still over the cap', async () => {
    const fetchPage = async (): Promise<BrregPage> => ({ total: BRREG_PAGE_CAP + 1, totalPages: 1, entities: [] });
    const res = await findBrregCandidates('taxi', 10, { orgForms: ['AS'], fetchPage, checkCodes: false, maxDateSplits: 1 });
    expect(res.errors.some((e) => /exceeds the API's 10000-result window/.test(e))).toBe(true);
  });

  it('puts the date range in the query only when there is one', () => {
    expect(brregQueryUrl('70.200', 'AS', 0, 1000, BRREG_FULL_RANGE)).toBe(
      'https://data.brreg.no/enhetsregisteret/api/enheter?naeringskode=70.200&size=1000&page=0&organisasjonsform=AS',
    );
    const u = new URL(brregQueryUrl('70.200', 'AS', 2, 500, { from: '2010-01-01', to: '2017-12-31' }));
    expect(u.searchParams.get('fraRegistreringsdatoEnhetsregisteret')).toBe('2010-01-01');
    expect(u.searchParams.get('tilRegistreringsdatoEnhetsregisteret')).toBe('2017-12-31');
    // An empty legal form means "every form" and must not be sent as a blank value,
    // which the API answers with a 400.
    expect(new URL(brregQueryUrl('70.200', '', 0, 1)).searchParams.has('organisasjonsform')).toBe(false);
  });

  it('halves a date range and stops when it cannot be halved again', () => {
    const half = splitDateRange({ from: '2020-01-01', to: '2020-12-31' });
    expect(half?.[0]).toEqual({ from: '2020-01-01', to: '2020-07-01' });
    expect(half?.[1]).toEqual({ from: '2020-07-02', to: '2020-12-31' });
    // Adjacent days and a single day cannot be split.
    expect(splitDateRange({ from: '2020-01-01', to: '2020-01-01' })).toBeNull();
    expect(splitDateRange({ from: '2020-01-02', to: '2020-01-01' })).toBeNull();
    // The unbounded range splits around the middle of the epoch window.
    expect(splitDateRange(BRREG_FULL_RANGE)?.[0].from).toBe('1800-01-01');
  });

  it('scores a Norwegian physiotherapy AS and drops the big consultancies from the agency codes', () => {
    const raw = {
      organisasjonsnummer: '912345678',
      navn: 'BERGEN FYSIOTERAPI AS',
      organisasjonsform: { kode: 'AS' },
      naeringskode1: { kode: '86.950', beskrivelse: 'Fysioterapitjeneste' },
      forretningsadresse: { poststed: 'BERGEN', postnummer: '5003', kommune: 'BERGEN', adresse: ['Strandgaten 1'] },
      epostadresse: 'post@bergenfysio.no',
      hjemmeside: 'www.bergenfysio.no',
      telefon: '55 12 34 56',
      antallAnsatte: 6,
    };
    const row = toBrregRow(raw);
    const lead = toBrregLead(row, naceFor('86.950'), keep(evaluateBrregRow(row, naceFor('86.950'))));
    expect(lead.sourceKey).toBe('physio:no:912345678');
    expect(lead.country).toBe('NO');
    expect(lead.location).toBe('Bergen, NO');
    expect(lead.email).toBe('post@bergenfysio.no');
    expect(lead.description).toBe('Listed in the Norwegian Enhetsregisteret register as a physiotherapy practice, based in Bergen, NO.');

    // The agency filter only applies to the agency codes.
    const agencyNace = naceFor('62.200');
    const big = toBrregRow({ ...raw, navn: 'ACCENTURE NORGE AS', naeringskode1: { kode: '62.200' } });
    expect(drop(evaluateBrregRow(big, agencyNace)).reason).toMatch(/large IT house/);
    // The same name under a VERTICAL code is not filtered by the agency list, so the
    // agency rule cannot leak into the verticals.
    const sameNameVertical = toBrregRow({ ...raw, navn: 'ACCENTURE NORGE AS' });
    expect(evaluateBrregRow(sameNameVertical, naceFor('86.950')).keep).toBe(true);

    // A small Norwegian agency is kept and keyed under the base product.
    const agency = toBrregRow({ ...raw, navn: 'NORD DIGITAL BYRÅ AS', naeringskode1: { kode: '62.200', beskrivelse: 'IT-konsulentvirksomhet' }, epostadresse: 'hei@norddigital.no' });
    const agencyLead = toBrregLead(agency, agencyNace, keep(evaluateBrregRow(agency, agencyNace)));
    expect(agencyLead.sourceKey).toBe('calldesk:no:912345678');
    expect(agencyLead.typeLabel).toBe('IT consultancy');
  });
});

// ===========================================================================
describe('France: authorised funeral operators', () => {
  const RAW: Record<string, string> = {
    [FR_FUNERAL_COLUMNS.name]: 'Au Repos du Bourbonnais',
    [FR_FUNERAL_COLUMNS.address]: '29, boulevard Gambetta',
    [FR_FUNERAL_COLUMNS.address2]: '',
    [FR_FUNERAL_COLUMNS.city]: 'LURCY-LÉVIS',
    [FR_FUNERAL_COLUMNS.postcode]: '03320',
    [FR_FUNERAL_COLUMNS.email]: 'contact@bourbonnais-lurcy-levis.com',
    [FR_FUNERAL_COLUMNS.phone]: '0470678487',
    [FR_FUNERAL_COLUMNS.mobile]: '0767179788',
    [FR_FUNERAL_COLUMNS.services]: "Le transport des corps avant et après mise en bière, L'organisation des obsèques, Les soins de conservation",
  };

  it('reads the real column names and builds a held French lead', () => {
    const row = toFrFuneralRow(RAW);
    expect(row.name).toBe('Au Repos du Bourbonnais');
    expect(row.email).toBe('contact@bourbonnais-lurcy-levis.com');
    const lead = toFrFuneralLead(row, keep(evaluateFrFuneralRow(row)));
    expect(lead.country).toBe('FR');
    expect(lead.location).toBe('Lurcy-Lévis, FR');
    expect(lead.typeLabel).toBe('funeral director');
    expect(lead.description).toBe('Listed in the French national list of authorised funeral operators as a funeral director, based in Lurcy-Lévis, FR.');
    expect(lead.sourceKey).toBe('funeral:fr:03320-au-repos-du-bourbonnais');
    // The unresolved licence travels with every lead, not just with a comment.
    expect(lead.signalDetail).toMatch(/licence "notspecified" — reuse terms to be confirmed with the DGCL/);
    // The description says nothing beyond the public record: no sales framing at all.
    expect(lead.description).not.toMatch(/miss|lose|revenue|opportunity|grow/i);
  });

  it('labels a crematorium and scores a thanatopraxie-only habilitation well down', () => {
    const crem = toFrFuneralRow({ ...RAW, [FR_FUNERAL_COLUMNS.name]: 'Crematorium du Sud', [FR_FUNERAL_COLUMNS.services]: "La gestion d'un crématorium" });
    expect(keep(evaluateFrFuneralRow(crem)).typeLabel).toBe('crematorium operator');
    const thanato = toFrFuneralRow({ ...RAW, [FR_FUNERAL_COLUMNS.services]: 'Les soins de conservation' });
    const ev = keep(evaluateFrFuneralRow(thanato));
    expect(ev.typeLabel).toBe('thanatopractic (embalming) service');
    expect(ev.adjust).toBeLessThan(0);
  });

  it('drops the national groups, the public authorities and the foreign or malformed rows', () => {
    expect(drop(evaluateFrFuneralRow(toFrFuneralRow({ ...RAW, [FR_FUNERAL_COLUMNS.name]: 'OGF SA' }))).reason).toMatch(/national funeral group/);
    expect(drop(evaluateFrFuneralRow(toFrFuneralRow({ ...RAW, [FR_FUNERAL_COLUMNS.name]: 'ROC ECLERC DIFFUSION' }))).reason).toMatch(/national funeral group/);
    expect(drop(evaluateFrFuneralRow(toFrFuneralRow({ ...RAW, [FR_FUNERAL_COLUMNS.name]: 'Ville de Toulouse' }))).reason).toMatch(/municipality/);
    expect(drop(evaluateFrFuneralRow(toFrFuneralRow({ ...RAW, [FR_FUNERAL_COLUMNS.postcode]: '00000' }))).reason).toMatch(/not a French one/);
    expect(drop(evaluateFrFuneralRow(toFrFuneralRow({ ...RAW, [FR_FUNERAL_COLUMNS.city]: '' }))).reason).toMatch(/no commune/);
    expect(drop(evaluateFrFuneralRow(toFrFuneralRow({ ...RAW, [FR_FUNERAL_COLUMNS.services]: 'La marbrerie funéraire' }))).reason).toMatch(/no recognised funeral service/);
  });

  it('dedupes on the derived key and on a shared mailbox, and keeps the required columns honest', async () => {
    const branchB = { ...RAW, [FR_FUNERAL_COLUMNS.name]: 'Au Repos du Bourbonnais Agence Nord', [FR_FUNERAL_COLUMNS.postcode]: '03100' };
    const res = await findFrFuneralCandidates(10, { rowsOverride: [RAW, { ...RAW }, branchB] });
    expect(res.scanned).toBe(3);
    expect(res.candidates).toHaveLength(1);
    expect(res.rejected['duplicate operator (same name and postcode)']).toBe(1);
    expect(res.rejected['duplicate email (branch of an operator already kept)']).toBe(1);
    // The required columns are the ones the parser actually reads.
    for (const c of FR_FUNERAL_REQUIRED) expect(Object.values(FR_FUNERAL_COLUMNS)).toContain(c);
  });

  it('resolves the newest CSV resource and ignores the xlsx and the old editions', () => {
    const resources = parseDataGouvResources({
      resources: [
        { format: 'xlsx', url: 'https://x/new.xlsx', last_modified: '2026-08-04T12:47:04' },
        { format: 'csv', url: 'https://x/new.csv', last_modified: '2026-08-04T12:46:34' },
        { format: 'csv', url: 'https://x/old.csv', last_modified: '2026-01-08T16:30:44' },
      ],
    });
    expect(resources).toHaveLength(3);
    expect(pickLatestCsv(resources)).toBe('https://x/new.csv');
    expect(pickLatestCsv([])).toBeNull();
    expect(pickLatestCsv(parseDataGouvResources({ resources: [{ format: 'xlsx', url: 'https://x/a.xlsx' }] }))).toBeNull();
  });

  it('keys a lead stably whatever the accents and punctuation', () => {
    expect(frFuneralKeyPart('POMPES FUNÈBRES DE L’ÉGLISE', '75011')).toBe('75011-pompes-funebres-de-l-eglise');
    expect(frFuneralSourceKey(toFrFuneralRow(RAW))).toMatch(/^funeral:fr:/);
  });
});

// ===========================================================================
describe('Québec: CPEs and garderies', () => {
  const RAW: Record<string, string> = {
    [QC_CPE_COLUMNS.name]: 'GARDERIE LES PETITS AMIS',
    [QC_CPE_COLUMNS.type]: 'GARD',
    [QC_CPE_COLUMNS.address]: '7, rue Saint-Augustin',
    [QC_CPE_COLUMNS.city]: 'Amqui',
    [QC_CPE_COLUMNS.postcode]: 'G5J 3H7',
    [QC_CPE_COLUMNS.region]: '1 - Bas-Saint-Laurent',
    [QC_CPE_COLUMNS.places]: '47',
    [QC_CPE_COLUMNS.subsidised]: 'CR',
    [QC_CPE_COLUMNS.phone]: '(418) 629-5363',
    [QC_CPE_COLUMNS.email]: 'info@lespetitsamis.ca',
  };

  it('reads INTERNET as the EMAIL and builds a Canadian, Canadian-French lead', () => {
    const row = toQcCpeRow(RAW);
    expect(row.email).toBe('info@lespetitsamis.ca');
    expect(row.places).toBe(47);
    expect(row.subsidised).toBe(true);
    const lead = toQcCpeLead(row, keep(evaluateQcCpeRow(row)));
    // The country is CA (the hold and release-country), the location carries QC (the
    // draft language). Both, on purpose.
    expect(lead.country).toBe(QC_COUNTRY);
    expect(lead.country).toBe('CA');
    expect(lead.state).toBe(QC_STATE);
    expect(lead.location).toBe('Amqui, QC');
    expect(detectDraftLanguage(lead.location)).toEqual({ code: 'fr-CA', name: 'Canadian French' });
    expect(lead.sourceKey).toBe('childcare:qc:G5J3H7-garderie-les-petits-amis');
    // CC-BY 4.0 attribution recorded on the lead itself.
    expect(lead.signalDetail).toContain(QC_LICENCE);
    expect(lead.signalDetail).toContain('donneesquebec.ca');
  });

  it('prefers a privately owned garderie to a CPE corporation', () => {
    const gard = keep(evaluateQcCpeRow(toQcCpeRow(RAW)));
    const cpe = keep(evaluateQcCpeRow(toQcCpeRow({ ...RAW, [QC_CPE_COLUMNS.type]: 'CPE' })));
    expect(gard.adjust).toBeGreaterThan(cpe.adjust);
    expect(cpe.reasons.join(' ')).toMatch(/non-profit corporation with a board/);
  });

  it('keeps a free-mail garderie as a reachable lead but scores it down', () => {
    const free = toQcCpeRow({ ...RAW, [QC_CPE_COLUMNS.email]: 'lesptitsflots@globetrotter.net' });
    const ev = keep(evaluateQcCpeRow(free));
    const lead = toQcCpeLead(free, ev);
    // The contact is kept (this is the childcare free-mail decision), but no domain
    // is claimed from it — the pipeline enforces the second half.
    expect(lead.email).toBe('lesptitsflots@globetrotter.net');
    expect(ev.reasons.join(' ')).toMatch(/free-mail/);
    expect(ev.adjust).toBeLessThan(keep(evaluateQcCpeRow(toQcCpeRow(RAW))).adjust);
  });

  it('collapses a CPE corporation’s installations onto its one shared mailbox', async () => {
    const a = { ...RAW, [QC_CPE_COLUMNS.name]: 'CPE LES PTITS FLOTS', [QC_CPE_COLUMNS.type]: 'CPE', [QC_CPE_COLUMNS.email]: 'flots@cpeflots.ca' };
    const b = { ...a, [QC_CPE_COLUMNS.name]: "CPE L'ANCRAGE", [QC_CPE_COLUMNS.postcode]: 'G5J 1H3' };
    const res = await findQcCpeCandidates(10, { rowsOverride: [a, b, RAW] });
    expect(res.scanned).toBe(3);
    expect(res.candidates.map((c) => c.name)).toEqual(['Cpe Les Ptits Flots', 'Garderie Les Petits Amis']);
    expect(res.rejected['shared mailbox with an installation already kept (same CPE corporation)']).toBe(1);
  });

  it('drops school boards, regional authorities and rows with no usable email', () => {
    expect(drop(evaluateQcCpeRow(toQcCpeRow({ ...RAW, [QC_CPE_COLUMNS.name]: 'Commission scolaire de Laval' }))).reason).toMatch(/school board/);
    expect(drop(evaluateQcCpeRow(toQcCpeRow({ ...RAW, [QC_CPE_COLUMNS.name]: 'Kativik Regional Government' }))).reason).toMatch(/regional authority/);
    expect(drop(evaluateQcCpeRow(toQcCpeRow({ ...RAW, [QC_CPE_COLUMNS.email]: '' }))).reason).toMatch(/no usable email/);
    expect(drop(evaluateQcCpeRow(toQcCpeRow({ ...RAW, [QC_CPE_COLUMNS.postcode]: '98101' }))).reason).toMatch(/Canadian postal code/);
    for (const p of ['G5J 3H7', 'G5J3H7', 'h2x1y4']) expect(isCanadianPostcode(p), p).toBe(true);
    for (const p of ['98101', '', null, 'G5J 3H']) expect(isCanadianPostcode(p), String(p)).toBe(false);
    // Required columns are all real columns.
    for (const c of QC_CPE_REQUIRED) expect(Object.values(QC_CPE_COLUMNS)).toContain(c);
  });
});

// ===========================================================================
describe('Québec: tourism accommodation', () => {
  const camping = QC_LODGING_FILES.find((f) => f.id === 'campings')!;
  const RAW: Record<string, string> = {
    [QC_LODGING_COLUMNS.registration]: '198004',
    [QC_LODGING_COLUMNS.name]: 'CAMPING CHEZ JEAN',
    [QC_LODGING_COLUMNS.genre]: 'Camping',
    [QC_LODGING_COLUMNS.street]: '434-A rue Principale',
    [QC_LODGING_COLUMNS.city]: 'Saint-Antonin',
    [QC_LODGING_COLUMNS.province]: 'Québec',
    [QC_LODGING_COLUMNS.postcode]: 'G0L2J0',
    [QC_LODGING_COLUMNS.country]: 'CANADA',
    [QC_LODGING_COLUMNS.region]: 'Bas-Saint-Laurent',
    [QC_LODGING_COLUMNS.phone]: '418 862-1234',
    [QC_LODGING_COLUMNS.website]: 'http://www.campingchezjean.com',
    [QC_LODGING_COLUMNS.email]: 'info@campingchezjean.com',
  };

  it('keys on the registration number and carries the register’s own website', () => {
    const row = toQcLodgingRow(RAW);
    const lead = toQcLodgingLead(row, camping, keep(evaluateQcLodgingRow(row, camping)));
    expect(lead.sourceKey).toBe('lodging:qc:198004');
    expect(lead.licenseId).toBe('198004');
    expect(lead.domain).toBe('campingchezjean.com');
    expect(lead.country).toBe('CA');
    expect(lead.location).toBe('Saint-Antonin, QC');
    expect(lead.typeLabel).toBe('registered campground');
    expect(lead.signalDetail).toContain(QC_LICENCE);
  });

  it('labels each genre, falling back to the file when the genre is unknown', () => {
    expect(qcLodgingLabel('Gîte touristique', 'x')).toBe('registered gîte (bed and breakfast)');
    expect(qcLodgingLabel('Pourvoirie', 'x')).toBe('registered pourvoirie (outfitter with lodging)');
    expect(qcLodgingLabel('Auberge', 'x')).toBe('registered inn');
    expect(qcLodgingLabel('Quelque chose de nouveau', 'registered campground')).toBe('registered campground');
    expect(qcLodgingDomain('www.example.qc.ca')).toBe('example.qc.ca');
    expect(qcLodgingDomain('')).toBeNull();
    expect(qcLodgingDomain('not a url at all')).toBeNull();
  });

  it('drops the chains, the park authorities, the non-Canadian and the unregistered rows', () => {
    expect(drop(evaluateQcLodgingRow(toQcLodgingRow({ ...RAW, [QC_LODGING_COLUMNS.name]: 'SEPAQ Parc du Bic' }), camping)).reason).toMatch(/public park authority/);
    expect(drop(evaluateQcLodgingRow(toQcLodgingRow({ ...RAW, [QC_LODGING_COLUMNS.name]: 'KOA Montreal South' }), camping)).reason).toMatch(/franchise/);
    expect(drop(evaluateQcLodgingRow(toQcLodgingRow({ ...RAW, [QC_LODGING_COLUMNS.registration]: '' }), camping)).reason).toMatch(/registration number/);
    expect(drop(evaluateQcLodgingRow(toQcLodgingRow({ ...RAW, [QC_LODGING_COLUMNS.country]: 'USA' }), camping)).reason).toMatch(/not in Canada/);
    expect(drop(evaluateQcLodgingRow(toQcLodgingRow({ ...RAW, [QC_LODGING_COLUMNS.email]: 'nope' }), camping)).reason).toMatch(/no usable email/);
    for (const c of QC_LODGING_REQUIRED) expect(Object.values(QC_LODGING_COLUMNS)).toContain(c);
  });

  it('walks all three files, keeps going when one fails, and never lists a property twice', async () => {
    const gite = { ...RAW, [QC_LODGING_COLUMNS.registration]: '222747', [QC_LODGING_COLUMNS.name]: 'LA BELLE VICTORIENNE', [QC_LODGING_COLUMNS.genre]: 'Gîte touristique', [QC_LODGING_COLUMNS.email]: 'info@bellevictorienne.ca', [QC_LODGING_COLUMNS.website]: '' };
    const res = await findQcLodgingCandidates(10, {
      rowsOverride: {
        campings: [RAW],
        // The same property listed again in another file: one lead, not two.
        gites: [gite, { ...RAW }],
        pourvoiries: [],
      },
    });
    expect(res.candidates.map((c) => c.sourceKey)).toEqual(['lodging:qc:198004', 'lodging:qc:222747']);
    expect(res.rejected['duplicate registration number']).toBe(1);
    expect(QC_LODGING_FILES.map((f) => f.id)).toEqual(['campings', 'gites', 'pourvoiries']);
    // Every file records its own registry name for the CC-BY attribution.
    for (const f of QC_LODGING_FILES) expect(f.registryName).toMatch(/Tourisme Québec/);
    expect(qcLodgingSourceKey(toQcLodgingRow(gite))).toBe('lodging:qc:222747');
  });
});

// ===========================================================================
describe('Singapore: ECDA licensed child care centres', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    centre_code: 'PT1234',
    organisation_code: 'PT',
    organisation_description: 'Little Stars Childcare Pte Ltd',
    centre_name: 'Little Stars Childcare @ Bishan',
    centre_contact_no: '62345678',
    centre_email_address: 'admin@littlestars.com.sg',
    centre_address: '12,BISHAN STREET 13,NIL,570013',
    postal_code: '570013',
    centre_website: 'https://www.littlestars.com.sg/',
    service_model: 'CC',
    ...over,
  });

  it('builds an English-drafted Singapore lead from the ECDA fields', () => {
    const row = toSgEcdaRow(raw());
    const lead = toSgEcdaLead(row, keep(evaluateSgEcdaRow(row, 1)));
    expect(lead.sourceKey).toBe('childcare:sg:PT1234');
    expect(lead.country).toBe('SG');
    expect(lead.location).toBe('Singapore, SG');
    expect(detectDraftLanguage(lead.location)).toBeNull();
    expect(lead.email).toBe('admin@littlestars.com.sg');
    expect(lead.domain).toBe('littlestars.com.sg');
    expect(lead.description).toMatch(/^Listed in the Singapore Early Childhood Development Agency \(ECDA\) list/);
    expect(sgEcdaDomain('https://www.x.com.sg/a')).toBe('x.com.sg');
    expect(sgEcdaSourceKey('pt1234')).toBe('childcare:sg:PT1234');
  });

  it('reads the literal "na" placeholder as missing', () => {
    const row = toSgEcdaRow(raw({ centre_website: 'na', tp_code: 'na', centre_email_address: 'na', emailaddress_lifesg: 'fallback@x.com.sg' }));
    expect(row.website).toBeNull();
    // The LifeSG columns are the documented fallback.
    expect(row.email).toBe('fallback@x.com.sg');
  });

  it('drops the anchor operators by name and by how many centres they run', () => {
    const chainByName = toSgEcdaRow(raw({ centre_name: 'My First Skool', organisation_description: 'NTUC First Campus Co-Operative Ltd' }));
    expect(drop(evaluateSgEcdaRow(chainByName, 1)).reason).toMatch(/anchor operator/);
    // The structural test: a chain the word list has never heard of.
    const unknownChain = toSgEcdaRow(raw({ organisation_description: 'Brand New Preschool Group Pte Ltd' }));
    expect(drop(evaluateSgEcdaRow(unknownChain, SG_MAX_CENTRES_PER_ORG + 1)).reason).toMatch(/runs 4 centres/);
    expect(evaluateSgEcdaRow(unknownChain, SG_MAX_CENTRES_PER_ORG).keep).toBe(true);
    // A one-centre operator scores above a three-centre one.
    expect(keep(evaluateSgEcdaRow(toSgEcdaRow(raw()), 1)).adjust)
      .toBeGreaterThan(keep(evaluateSgEcdaRow(toSgEcdaRow(raw()), 3)).adjust);
    expect(drop(evaluateSgEcdaRow(toSgEcdaRow(raw({ postal_code: '5700' })), 1)).reason).toMatch(/postal code/);
    for (const p of ['570013', '018956']) expect(isSgPostcode(p), p).toBe(true);
    for (const p of ['5700', '', null, '5700133']) expect(isSgPostcode(p), String(p)).toBe(false);
  });

  it('counts centres per operator from the whole list before judging any of them', async () => {
    const chain = [1, 2, 3, 4].map((n) => raw({
      centre_code: `BG000${n}`, organisation_code: 'BG', organisation_description: 'Big Group Pte Ltd',
      centre_name: `Big Group Centre ${n}`, centre_email_address: `c${n}@biggroup.com.sg`,
    }));
    const counts = countCentresPerOrg([...chain, raw()].map(toSgEcdaRow));
    expect(counts.get('BG')).toBe(4);
    expect(counts.get('PT')).toBe(1);
    const res = await findSgEcdaCandidates(20, { pagesOverride: [{ total: 5, records: [...chain, raw()] }] });
    expect(res.scanned).toBe(5);
    expect(res.candidates.map((c) => c.licenseId)).toEqual(['PT1234']);
    expect(res.rejected['operator runs 4 centres, so it is a chain with a head office rather than an owner-run centre']).toBe(4);
  });

  it('treats an in-body TOO_MANY_REQUESTS as a retryable rate limit, not as end-of-data', () => {
    expect(() => parseSgPage({ success: false, error: { __type: 'Too Many Requests Error', message: 'TOO_MANY_REQUESTS' } }))
      .toThrow(SgRateLimited);
    // Any other datastore error is a real error, not something to retry blindly.
    expect(() => parseSgPage({ success: false, error: { message: 'Resource not found' } })).toThrow(/Resource not found/);
    expect(() => parseSgPage({ result: {} })).toThrow(/no records array/);
    expect(parseSgPage({ result: { total: 1871, records: [{ centre_code: 'X' }] } }))
      .toEqual({ total: 1871, records: [{ centre_code: 'X' }] });
    const u = new URL(sgEcdaPageUrl(500, 1000));
    expect(u.searchParams.get('limit')).toBe('500');
    expect(u.searchParams.get('offset')).toBe('1000');
    expect(u.searchParams.get('resource_id')).toBe('d_696c994c50745b079b3684f0e90ffc53');
  });
});

// ===========================================================================
describe('Estonia: agency leads from the business register', () => {
  const company = (over: Record<string, unknown> = {}, yldOver: Record<string, unknown> = {}) => ({
    ariregistri_kood: 16752073,
    nimi: 'Nord Digital OÜ',
    yldandmed: {
      staatus: 'R',
      tegutseb_tekstina: 'Jah',
      kustutamise_kpv: null,
      oiguslik_vorm: 'OÜ',
      teatatud_tegevusalad: [{ nace_kood: '62.10', emtak_kood: '62011', on_pohitegevusala: true }],
      sidevahendid: [
        { liik: 'EMAIL', sisu: 'info@norddigital.ee', lopp_kpv: null },
        { liik: 'MOB', sisu: '+372 5587811', lopp_kpv: null },
        { liik: 'WWW', sisu: 'https://norddigital.ee/', lopp_kpv: null },
      ],
      aadressid: [{ ehak_nimetus: 'Kesklinna linnaosa, Tallinn, Harju maakond', postiindeks: '10117', tanav_maja_korter: 'Narva mnt 5', lopp_kpv: null }],
      info_majandusaasta_aruannetest: [
        { majandusaasta_perioodi_lopp_kpv: '31.12.2024', tootajate_arv: '4' },
        { majandusaasta_perioodi_lopp_kpv: '31.12.2025', tootajate_arv: '7' },
      ],
      ...yldOver,
    },
    ...over,
  });

  it('reads the nested register shape and builds an English-drafted EE agency lead', () => {
    const row = toEeRow(company());
    expect(row.code).toBe('16752073');
    expect(row.form).toBe('OÜ');
    expect(row.email).toBe('info@norddigital.ee');
    expect(row.phone).toBe('+372 5587811');
    expect(row.website).toBe('https://norddigital.ee/');
    // The city is the segment before the county, not the borough.
    expect(row.city).toBe('Tallinn');
    // The NEWEST annual report wins, not the first in the array.
    expect(row.employees).toBe(7);
    const lead = toEeLead(row, keep(evaluateEeRow(row)));
    expect(lead.sourceKey).toBe('calldesk:ee:16752073');
    expect(lead.country).toBe('EE');
    expect(lead.location).toBe('Tallinn, EE');
    expect(detectDraftLanguage(lead.location)).toBeNull();
    expect(lead.domain).toBe('norddigital.ee');
    expect(lead.typeLabel).toBe('software development agency');
    expect(lead.signalDetail).toMatch(/7 employees per the 31\.12\.2025 annual report/);
    expect(eeDateKey('05.06.2023')).toBe('2023-06-05');
    expect(eeDateKey(null)).toBe('');
    expect(eeDomain('www.x.ee')).toBe('x.ee');
  });

  it('keeps only live companies in an agency NACE code with a real payroll', () => {
    const naceMiss = toEeRow(company({}, { teatatud_tegevusalad: [{ nace_kood: '68.20' }] }));
    expect(drop(evaluateEeRow(naceMiss)).reason).toMatch(/agency\/consultancy NACE/);
    const fie = toEeRow(company({}, { oiguslik_vorm: 'FIE' }));
    expect(drop(evaluateEeRow(fie)).reason).toMatch(/not a company/);
    const mtu = toEeRow(company({}, { oiguslik_vorm: 'MTÜ' }));
    expect(drop(evaluateEeRow(mtu)).reason).toMatch(/not a company/);
    const struck = toEeRow(company({}, { staatus: 'K' }));
    expect(drop(evaluateEeRow(struck)).reason).toMatch(/not on the register/);
    const dead = toEeRow(company({}, { tegutseb_tekstina: 'Ei' }));
    expect(drop(evaluateEeRow(dead)).reason).toMatch(/no longer trading/);
    const noEmail = toEeRow(company({}, { sidevahendid: [{ liik: 'MOB', sisu: '+372 1' }] }));
    expect(drop(evaluateEeRow(noEmail)).reason).toMatch(/no usable email/);
    const big = toEeRow(company({ nimi: 'Nortal AS' }));
    expect(drop(evaluateEeRow(big)).reason).toMatch(/large IT house/);

    // THE SHELL FILTER: no report at all, and a report showing a one-person payroll.
    const noReport = toEeRow(company({}, { info_majandusaasta_aruannetest: null }));
    expect(drop(evaluateEeRow(noReport)).reason).toMatch(/no annual report on file/);
    const shell = toEeRow(company({}, { info_majandusaasta_aruannetest: [{ majandusaasta_perioodi_lopp_kpv: '31.12.2025', tootajate_arv: '0' }] }));
    expect(drop(evaluateEeRow(shell)).reason).toMatch(/0 employee\(s\)/);
    const oneMan = toEeRow(company({}, { info_majandusaasta_aruannetest: [{ majandusaasta_perioodi_lopp_kpv: '31.12.2025', tootajate_arv: String(EE_MIN_EMPLOYEES - 1) }] }));
    expect(drop(evaluateEeRow(oneMan)).reason).toMatch(/one-person invoicing vehicle/);
    const justEnough = toEeRow(company({}, { info_majandusaasta_aruannetest: [{ majandusaasta_perioodi_lopp_kpv: '31.12.2025', tootajate_arv: String(EE_MIN_EMPLOYEES) }] }));
    expect(evaluateEeRow(justEnough).keep).toBe(true);
    // Too large is also wrong for a design-partner pitch.
    const huge = toEeRow(company({}, { info_majandusaasta_aruannetest: [{ majandusaasta_perioodi_lopp_kpv: '31.12.2025', tootajate_arv: '900' }] }));
    expect(keep(evaluateEeRow(huge)).reasons.join(' ')).toMatch(/too large/);
    expect(eeSourceKey('1675-2073')).toBe('calldesk:ee:16752073');
  });

  it('splits a JSON array into top-level objects without being fooled by braces in strings', () => {
    const s = new JsonObjectSplitter();
    // Fed in awkward pieces, as an inflate stream really arrives.
    const out = [
      ...s.feed('[\n  {"a":{"b":1},"n":"a }{ brace \\" and quote"},'),
      ...s.feed('\n  {"a":2}'),
      ...s.feed('\n]'),
    ];
    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0]).n).toBe('a }{ brace " and quote');
    expect(JSON.parse(out[1])).toEqual({ a: 2 });
  });

  it('finds where the deflate data starts in the Zip64 local header, and rejects the rest', () => {
    const mk = (method: number, nameLen: number, extraLen: number, sig = 0x04034b50) => {
      const b = new Uint8Array(30 + nameLen + extraLen);
      const v = new DataView(b.buffer);
      v.setUint32(0, sig, true);
      v.setUint16(8, method, true);
      v.setUint16(26, nameLen, true);
      v.setUint16(28, extraLen, true);
      b.set(new TextEncoder().encode('x'.repeat(nameLen)), 30);
      return b;
    };
    // The real file: 37-byte name, 20-byte Zip64 extra field, deflate.
    expect(parseZipLocalHeader(mk(8, 37, 20)).dataOffset).toBe(87);
    expect(parseZipLocalHeader(mk(8, 37, 20)).name).toHaveLength(37);
    expect(() => parseZipLocalHeader(mk(0, 37, 20))).toThrow(/compression method 0/);
    expect(() => parseZipLocalHeader(mk(8, 37, 20, 0xdeadbeef))).toThrow(/bad local file header signature/);
    expect(() => parseZipLocalHeader(new Uint8Array(10))).toThrow(/not enough bytes/);
  });

  it('dedupes on the domain, so a group’s companies become one lead', async () => {
    const text = JSON.stringify([
      company(),
      // Same website, different registry code: one lead.
      company({ ariregistri_kood: 16752074, nimi: 'Nord Digital Studio OÜ' }),
      company({ ariregistri_kood: 16752075, nimi: 'Teine Byroo OÜ' }, {
        sidevahendid: [
          { liik: 'EMAIL', sisu: 'tere@teinebyroo.ee', lopp_kpv: null },
          { liik: 'WWW', sisu: 'https://teinebyroo.ee', lopp_kpv: null },
        ],
      }),
    ]);
    const res = await findEeAgencyCandidates(10, { textOverride: text });
    expect(res.scanned).toBe(3);
    expect(res.candidates.map((c) => c.licenseId)).toEqual(['16752073', '16752075']);
    expect(res.rejected['duplicate domain (same group or shared website)']).toBe(1);
  });
});

// ===========================================================================
describe('the international hold, for every new source', () => {
  it('stores each one region_blocked with signals.intlHold and the right country', async () => {
    const { registryLeadRow } = await import('@/lib/outreach/discovery/pipeline');
    const now = '2026-09-24T12:00:00.000Z';

    const frRow = toFrFuneralRow({
      [FR_FUNERAL_COLUMNS.name]: 'Pompes Funebres Centrales',
      [FR_FUNERAL_COLUMNS.city]: 'SAINT AVOLD',
      [FR_FUNERAL_COLUMNS.postcode]: '57500',
      [FR_FUNERAL_COLUMNS.email]: 'pfcentrales@pfcentrales.fr',
      [FR_FUNERAL_COLUMNS.phone]: '0387927272',
      [FR_FUNERAL_COLUMNS.services]: "L'organisation des obsèques",
    });
    const fr = registryLeadRow(toFrFuneralLead(frRow, keep(evaluateFrFuneralRow(frRow))), funeral, now);
    expect(fr.fields.region_blocked).toBe(true);
    expect(fr.fields.signals.intlHold).toEqual({ country: 'FR', reason: INTL_HOLD_REASON });
    expect(fr.fields.contact_status).toBe('found');

    const qcRow = toQcCpeRow({
      [QC_CPE_COLUMNS.name]: 'GARDERIE LES PETITS AMIS', [QC_CPE_COLUMNS.type]: 'GARD',
      [QC_CPE_COLUMNS.city]: 'Amqui', [QC_CPE_COLUMNS.postcode]: 'G5J 3H7',
      [QC_CPE_COLUMNS.email]: 'lespetits@videotron.ca', [QC_CPE_COLUMNS.phone]: '(418) 629-5363',
    });
    const qc = registryLeadRow(toQcCpeLead(qcRow, keep(evaluateQcCpeRow(qcRow))), childcare, now);
    // CA, not QC: "QC" is not a country and release-country works on the country.
    expect(qc.fields.signals.intlHold).toEqual({ country: 'CA', reason: INTL_HOLD_REASON });
    expect(qc.fields.region_blocked).toBe(true);
    // A free-mail contact is kept but yields NO domain — the pipeline's half of the
    // childcare free-mail decision.
    expect(qc.fields.contact_email).toBe('lespetits@videotron.ca');
    expect(qc.fields.domain).toBeNull();

    const lodgeFile = QC_LODGING_FILES[0];
    const lodgeRow = toQcLodgingRow({
      [QC_LODGING_COLUMNS.registration]: '198004', [QC_LODGING_COLUMNS.name]: 'CAMPING CHEZ JEAN',
      [QC_LODGING_COLUMNS.genre]: 'Camping', [QC_LODGING_COLUMNS.city]: 'Saint-Antonin',
      [QC_LODGING_COLUMNS.country]: 'CANADA', [QC_LODGING_COLUMNS.email]: 'info@campingchezjean.com',
      [QC_LODGING_COLUMNS.website]: 'http://www.campingchezjean.com',
    });
    const lodge = registryLeadRow(toQcLodgingLead(lodgeRow, lodgeFile, keep(evaluateQcLodgingRow(lodgeRow, lodgeFile))), lodging, now);
    expect(lodge.fields.signals.intlHold).toEqual({ country: 'CA', reason: INTL_HOLD_REASON });
    expect(lodge.fields.domain).toBe('campingchezjean.com');

    const sgRow = toSgEcdaRow({
      centre_code: 'PT1234', organisation_code: 'PT', organisation_description: 'Little Stars Childcare Pte Ltd',
      centre_name: 'Little Stars Childcare @ Bishan', centre_email_address: 'admin@littlestars.com.sg',
      postal_code: '570013', centre_contact_no: '62345678', centre_website: 'https://littlestars.com.sg',
    });
    const sg = registryLeadRow(toSgEcdaLead(sgRow, keep(evaluateSgEcdaRow(sgRow, 1))), childcare, now);
    expect(sg.fields.signals.intlHold).toEqual({ country: 'SG', reason: INTL_HOLD_REASON });
    expect(sg.fields.region_blocked).toBe(true);

    const eeRow = toEeRow({
      ariregistri_kood: 16752073, nimi: 'Nord Digital OÜ',
      yldandmed: {
        staatus: 'R', oiguslik_vorm: 'OÜ', tegutseb_tekstina: 'Jah',
        teatatud_tegevusalad: [{ nace_kood: '73.11', on_pohitegevusala: true }],
        sidevahendid: [{ liik: 'EMAIL', sisu: 'info@norddigital.ee' }],
        aadressid: [{ ehak_nimetus: 'Kesklinna linnaosa, Tallinn, Harju maakond' }],
        info_majandusaasta_aruannetest: [{ majandusaasta_perioodi_lopp_kpv: '31.12.2025', tootajate_arv: '6' }],
      },
    });
    const ee = registryLeadRow(toEeLead(eeRow, keep(evaluateEeRow(eeRow))), calldesk, now);
    expect(ee.fields.signals.intlHold).toEqual({ country: 'EE', reason: INTL_HOLD_REASON });
    expect(ee.fields.region_blocked).toBe(true);

    // A Norwegian AGENCY lead is held exactly like a Norwegian vertical lead.
    const noAgency = toBrregRow({
      organisasjonsnummer: '912345678', navn: 'NORD DIGITAL BYRÅ AS',
      organisasjonsform: { kode: 'AS' }, naeringskode1: { kode: '62.200' },
      forretningsadresse: { poststed: 'OSLO' }, epostadresse: 'hei@norddigital.no', antallAnsatte: 5,
    });
    const agencyNace = BRREG_NACE.find((c) => c.code === '62.200') as BrregNaceClass;
    const no = registryLeadRow(toBrregLead(noAgency, agencyNace, keep(evaluateBrregRow(noAgency, agencyNace))), calldesk, now);
    expect(no.fields.signals.intlHold).toEqual({ country: 'NO', reason: INTL_HOLD_REASON });
    expect(no.fields.region_blocked).toBe(true);
  });

  it('registers every new bulk source against the right product, bulk-import only', async () => {
    const { BULK_REGISTRY_SOURCE_IDS, bulkRegistrySourcesFor } = await import('@/lib/outreach/discovery/pipeline');
    for (const id of ['fr-funeral', 'qc-cpe', 'qc-lodging', 'sg-ecda', 'ee-agencies']) {
      expect(BULK_REGISTRY_SOURCE_IDS, id).toContain(id);
    }
    expect(bulkRegistrySourcesFor(funeral)).toEqual(['fr-funeral']);
    expect(bulkRegistrySourcesFor(lodging)).toEqual(['qc-lodging']);
    expect(bulkRegistrySourcesFor(childcare)).toEqual(expect.arrayContaining(['tx-childcare', 'qc-cpe', 'sg-ecda']));
    expect(bulkRegistrySourcesFor(calldesk)).toEqual(expect.arrayContaining(['no-brreg', 'ee-agencies']));
    // The new Norwegian verticals reach Norway through the existing source id.
    for (const p of [physio, taxi, accounting, vets, realestate]) expect(bulkRegistrySourcesFor(p)).toEqual(['no-brreg']);
    // And the existing US sources are untouched.
    expect(BULK_REGISTRY_SOURCE_IDS).toEqual(expect.arrayContaining(['fl-dfs', 'nyc-dob', 'va-dpor', 'ar-clb', 'ca-cdph', 'fr-rge', 'uk-cqc', 'uk-dvsa']));
  });

  it('rejects a bulk import of a source that is not that product’s', async () => {
    const { bulkImportRegistry } = await import('@/lib/outreach/discovery/pipeline');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(bulkImportRegistry({} as any, funeral, 'qc-cpe', { dryRun: true })).rejects.toThrow(/is for childcare, not funeral/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(bulkImportRegistry({} as any, funeral, 'nope', { dryRun: true })).rejects.toThrow(/unknown bulk import source/);
  });
});
