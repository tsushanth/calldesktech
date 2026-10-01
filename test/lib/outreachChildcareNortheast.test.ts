import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  evaluateNjRow, toNjLead, evaluateMaRow, toMaLead, evaluateCtRow, toCtLead,
  evaluateNyRow, toNyLead, evaluateVtRow, toVtLead, toCapacity, allNeChildcareLeads,
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
