import { describe, it, expect } from 'vitest';
import {
  toCslbRow, evaluateCslbRow, toCslbLead, cslbDisplayName, parseCslbDate, aspField, streamCslbLeads, cslbSourceKey,
} from '@/lib/outreach/discovery/homeservicesCaCslb';
import { evaluateCaCclRow, toCaCclLead, allCaCclLeads, caCclSourceKey, type CaCclRow } from '@/lib/outreach/discovery/childcareCaCdss';
import { looksLikeIndividual } from '@/lib/outreach/discovery/individualName';

const NOW = new Date('2026-09-30T12:00:00Z');

const HEADER = 'LicenseNo,LastUpdate,BusinessName,BUS-NAME-2,FullBusinessName,MailingAddress,City,State,County,ZIPCode,country,BusinessPhone,BusinessType,IssueDate,ReissueDate,ExpirationDate,InactivationDate,ReactivationDate,PendingSuspension,PendingClassRemoval,PendingClassReplace,PrimaryStatus,SecondaryStatus,Classifications(s)';
const line = (o: Partial<Record<string, string>>) => {
  const d: Record<string, string> = {
    LicenseNo: '900001', LastUpdate: '09/25/2026', BusinessName: 'ACME PLUMBING INC', 'BUS-NAME-2': '', FullBusinessName: '', MailingAddress: '1 MAIN ST', City: 'FRESNO', State: 'CA', County: 'Fresno', ZIPCode: '93721',
    country: '', BusinessPhone: '(559) 555 0100', BusinessType: 'Corporation', IssueDate: '01/01/2015', ReissueDate: '', ExpirationDate: '01/31/2028', InactivationDate: '', ReactivationDate: '',
    PendingSuspension: '', PendingClassRemoval: '', PendingClassReplace: '', PrimaryStatus: 'CLEAR', SecondaryStatus: '', 'Classifications(s)': 'C36', ...o,
  };
  return HEADER.split(',').map((h) => (/[,"]/.test(d[h]) ? `"${d[h]}"` : d[h])).join(',');
};

const row = (o: Partial<Record<string, string>> = {}) => {
  const d = Object.fromEntries(HEADER.split(',').map((h) => [h, ''])) as Record<string, string>;
  const parsed = line(o).split(',');
  HEADER.split(',').forEach((h, i) => { d[h] = parsed[i]?.replace(/^"|"$/g, '') ?? ''; });
  return toCslbRow(d);
};

describe('CSLB contractor master list loader', () => {
  it('keeps an active plumbing licence with a phone and builds a phone-first lead with no email', () => {
    const r = row();
    const ev = evaluateCslbRow(r, NOW);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    const lead = toCslbLead(r, ev);
    expect(lead.sourceKey).toBe('homeservices:ca:900001');
    expect(lead.sourceKey).toBe(cslbSourceKey(r));
    expect(lead.name).toBe('Acme Plumbing INC');
    expect(lead.phone).toBe('(559) 555-0100');
    expect(lead.email).toBeNull();
    expect(lead.state).toBe('CA');
    expect(lead.typeLabel).toBe('licensed plumbing contractor');
    expect(lead.description).toContain('California Contractors State License Board');
    expect(lead.description).toContain('Fresno, CA');
  });

  it('normalises pipe separated classifications', () => {
    expect(row({ 'Classifications(s)': 'B| C-10' }).classes).toEqual(['B', 'C10']);
  });

  it('rejects inactive, expired, wc-suspension, non-trade, brand and phoneless rows with reasons', () => {
    const why = (o: Partial<Record<string, string>>) => { const ev = evaluateCslbRow(row(o), NOW); return ev.keep ? 'KEPT' : ev.reason; };
    expect(why({ PrimaryStatus: 'Contr Bond Susp' })).toMatch(/not active/);
    expect(why({ SecondaryStatus: 'WC Susp Pending' })).toMatch(/workers/);
    expect(why({ ExpirationDate: '01/31/2026' })).toBe('licence expired');
    expect(why({ 'Classifications(s)': 'C27' })).toMatch(/not an HVAC/);
    expect(why({ BusinessName: 'ROTO-ROOTER SERVICES CO' })).toMatch(/national brand/);
    expect(why({ BusinessPhone: '' })).toMatch(/no usable phone/);
  });

  it('keeps a general B licence only when the name reads like a trade, and words it generically', () => {
    expect(evaluateCslbRow(row({ 'Classifications(s)': 'B', BusinessName: 'BAY ROOFING CO' }), NOW)).toMatchObject({ keep: true, typeLabel: 'licensed contractor' });
    expect(evaluateCslbRow(row({ 'Classifications(s)': 'B', BusinessName: 'SMITH BUILDERS' }), NOW).keep).toBe(false);
  });

  it('prefers the trade the business name names when a licence holds several', () => {
    const ev = evaluateCslbRow(row({ BusinessName: 'DESERT ELITE ELECTRIC', 'Classifications(s)': 'C36| C10' }), NOW);
    expect(ev).toMatchObject({ keep: true, typeLabel: 'licensed electrical contractor' });
  });

  it('shows a sole owner by natural-order name, marked down, and recognised as an individual', () => {
    const r = row({ BusinessName: 'DOCKERY RANDALL MARK', FullBusinessName: 'RANDALL MARK DOCKERY', BusinessType: 'Sole Owner', 'Classifications(s)': 'C10' });
    const d = cslbDisplayName(r);
    expect(d).toMatchObject({ name: 'Randall Mark Dockery', individual: true });
    expect(looksLikeIndividual(d.name)).toBe(true);
    const ev = evaluateCslbRow(r, NOW);
    expect(ev.keep).toBe(true);
    if (ev.keep) expect(ev.reasons.join(' ')).toMatch(/sole proprietor/);
  });

  it('uses the DBA name and keeps the legal name separately for a corporation', () => {
    const d = cslbDisplayName(row({ BusinessName: 'BAYSIDE ELECTRIC', 'BUS-NAME-2': 'M TABBERT INC', FullBusinessName: 'M TABBERT INC DBA BAYSIDE ELECTRIC' }));
    expect(d.name).toBe('Bayside Electric');
    expect(d.legalName).toBe('M Tabbert INC');
  });

  it('parses MM/DD/YYYY dates and ASP.NET hidden fields', () => {
    expect(parseCslbDate('09/25/2026')?.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(parseCslbDate('')).toBeNull();
    expect(aspField('<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="abc/+=" />', '__VIEWSTATE')).toBe('abc/+=');
    expect(aspField('1|#||x|2|hiddenField|__EVENTVALIDATION|zz9=|0|', '__EVENTVALIDATION')).toBe('zz9=');
    expect(() => aspField('nothing', '__VIEWSTATE')).toThrow(/not found/);
  });

  it('streams a CSV body in awkward chunks, counts rows and reports the freshest LastUpdate', async () => {
    const filler = Array.from({ length: 1000 }, (_, i) => line({ LicenseNo: String(100000 + i), 'Classifications(s)': 'C27', LastUpdate: '01/02/2026' }));
    const body = [HEADER, line({ LicenseNo: '777', LastUpdate: '09/29/2026', BusinessName: 'ACME, PLUMBING & SONS' }), ...filler, ''].join('\r\n');
    const enc = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < enc.length; i += 37) c.enqueue(enc.slice(i, i + 37)); c.close(); },
    });
    const res = await streamCslbLeads({ now: NOW, response: new Response(stream, { headers: { 'content-type': 'text/csv' } }) });
    expect(res.errors).toEqual([]);
    expect(res.scanned).toBe(1001);
    expect(res.freshest).toBe('2026-09-29');
    expect(res.candidates.map((c) => c.sourceKey)).toEqual(['homeservices:ca:777']);
    expect(res.candidates[0].name).toBe('Acme, Plumbing & Sons');
    expect(res.rejected['classification is not an HVAC/plumbing/electrical/roofing trade']).toBe(1000);
  });

  it('reports an error instead of empty output when the header is missing', async () => {
    const res = await streamCslbLeads({ now: NOW, response: new Response('<html>error</html>\n<p>x</p>\n') });
    expect(res.errors[0]).toMatch(/header/);
    expect(res.candidates).toEqual([]);
  });
});

const ccl = (o: Partial<CaCclRow> = {}): CaCclRow => ({
  FAC_NBR: 197416900, NAME: 'LITTLE ROOTS PRESCHOOL   ', PROGRAM_TYPE: 'CHILD CARE', FAC_TYPE_DESC: 'DAY CARE CENTER', STATUS: 3, CAPACITY: 40,
  RES_CITY: 'SAN DIEGO     ', RES_STATE: 'CA', FAC_PHONE_NBR: 6198629887, COUNTY: 'San Diego County', ...o,
});

describe('California CDSS child care center loader', () => {
  it('keeps a licensed center and formats the numeric phone', () => {
    const r = ccl();
    const ev = evaluateCaCclRow(r);
    expect(ev.keep).toBe(true);
    if (!ev.keep) return;
    const lead = toCaCclLead(r, ev);
    expect(lead.sourceKey).toBe('childcare:ca:197416900');
    expect(lead.sourceKey).toBe(caCclSourceKey(r));
    expect(lead.name).toBe('Little Roots Preschool');
    expect(lead.city).toBe('San Diego');
    expect(lead.phone).toBe('(619) 862-9887');
    expect(lead.email).toBeNull();
    expect(lead.description).toContain('licensed child care center');
    expect(lead.description).toContain('San Diego, CA');
    expect(lead.signalDetail).toContain('San Diego County');
  });

  it('rejects residential, non-licensed status, chains and phoneless rows', () => {
    const why = (o: Partial<CaCclRow>) => { const ev = evaluateCaCclRow(ccl(o)); return ev.keep ? 'KEPT' : ev.reason; };
    expect(why({ PROGRAM_TYPE: 'ADULT AND SENIOR' })).toMatch(/not a child care center/);
    expect(why({ STATUS: 6 })).toMatch(/not 3/);
    expect(why({ NAME: 'KINDERCARE LEARNING CENTER' })).toMatch(/chain/);
    expect(why({ FAC_PHONE_NBR: null })).toMatch(/no usable phone/);
    expect(why({ FAC_NBR: '' })).toMatch(/no facility number/);
  });

  it('marks a school-district programme down relative to an independent centre', () => {
    const a = evaluateCaCclRow(ccl());
    const b = evaluateCaCclRow(ccl({ NAME: 'LINCOLN ELEMENTARY SCHOOL DISTRICT PRESCHOOL' }));
    expect(a.keep && b.keep).toBe(true);
    if (a.keep && b.keep) expect(b.adjust).toBeLessThan(a.adjust);
  });

  it('runs a whole population through the evaluator and honours isKnown', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ccl({ FAC_NBR: 500000 + i, NAME: `CENTER ${i}` }));
    rows.push(ccl({ FAC_NBR: 1, NAME: 'KUMON LEARNING', PROGRAM_TYPE: 'ADULT AND SENIOR' }));
    const res = await allCaCclLeads({ fetchRows: async () => rows, isKnown: (k) => k === 'childcare:ca:500000' });
    expect(res.errors).toEqual([]);
    expect(res.scanned).toBe(1201);
    expect(res.candidates).toHaveLength(1199);
    expect(res.rejected['already known']).toBe(1);
  });

  it('errors rather than returning nothing when the layer shrinks', async () => {
    const res = await allCaCclLeads({ fetchRows: async () => [ccl()] });
    expect(res.errors[0]).toMatch(/layer may have changed/);
  });
});
