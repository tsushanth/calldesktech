import { describe, it, expect } from 'vitest';
import { callerPhoneExclusion } from '@/lib/outreach/discovery/callerPhonePolicy';
import { registryLeadRow } from '@/lib/outreach/discovery/pipeline';
import { calldesk } from '@/lib/outreach/products';
import type { RegistryLead } from '@/lib/outreach/discovery/registryCommon';

const base: RegistryLead = {
  sourceKey: 'childcare:xx:1', name: 'Little Acorns Learning Center', legalName: null, city: 'Salem', state: 'OR', phone: '(503) 555-0142',
  licenseId: '1', registryName: 'Test registry', typeLabel: 'licensed child care centre', contactName: null, location: 'Salem, OR',
  description: 'x', signalDetail: 'y', adjust: 0, reasons: [],
};

describe('callerPhoneExclusion', () => {
  it('excludes sole proprietors, home-based providers and person-named businesses', () => {
    expect(callerPhoneExclusion({ name: 'Acme Plumbing LLC', soleProprietor: true })).toBe('sole proprietor');
    expect(callerPhoneExclusion({ name: 'Sunny Days', homeBased: true })).toBe('home-based provider');
    for (const t of ['Family Child Care Home', 'Group Family Child Care', 'licensed family child care', 'In-Home Day Care', 'In-Home Montessori Daycare', 'In Home Child Care', 'Registered Family Home', 'Home Day Care', 'Child Care Home'])
      expect(callerPhoneExclusion({ name: 'Sunny Days', typeLabel: t }), t).toBe('home-based provider');
    expect(callerPhoneExclusion({ name: 'Jeffrey Kyle Porter' })).toBe('person-named business');
  });
  it('does not read "licensed home care/health agency" as a licensed (family) home', () => {
    for (const t of ['licensed home care agency', 'licensed home health agency', 'licensed home care agency (skilled nursing)'])
      expect(callerPhoneExclusion({ name: 'Sunny Care LLC', typeLabel: t }), t).toBeNull();
    expect(callerPhoneExclusion({ name: 'Sunny Days', typeLabel: 'licensed family child care home' })).toBe('home-based provider');
  });
  it('keeps ordinary businesses and centres', () => {
    expect(callerPhoneExclusion({ name: 'Little Acorns Learning Center', typeLabel: 'Licensed Child Care Center' })).toBeNull();
    expect(callerPhoneExclusion({ name: 'Chantilly Electric LLC' })).toBeNull();
  });
});

describe('registryLeadRow caller-phone exclusion', () => {
  it('writes the phone column and registry phone normally', () => {
    const { fields } = registryLeadRow(base, calldesk, '2026-10-01T00:00:00Z');
    expect((fields as { phone?: string }).phone).toBe('(503) 555-0142');
    expect((fields.signals.registry as { phone: string | null }).phone).toBe('(503) 555-0142');
  });
  it('keeps an excluded lead off callers lists: no phone column, no registry phone, reason recorded, email kept', () => {
    const { fields, email } = registryLeadRow({ ...base, email: 'owner@littleacorns.org', callerPhoneExcluded: 'home-based provider' }, calldesk, '2026-10-01T00:00:00Z');
    expect('phone' in fields).toBe(false);
    const reg = fields.signals.registry as { phone: string | null; callerPhoneExcluded?: string };
    expect(reg.phone).toBeNull();
    expect(reg.callerPhoneExcluded).toBe('home-based provider');
    expect(email).toBe('owner@littleacorns.org');
  });
});

describe('HOME_BASED_RE does not misfire on home care or contractor labels', () => {
  it('keeps licensed home care agencies, in-home care, and residential contractors', () => {
    for (const t of ['licensed home care agency', 'Licensed Home Health Agency', 'In-Home Care Services', 'Residential Roofing Contractor', 'residential plumbing', 'licensed home nursing agency'])
      expect(callerPhoneExclusion({ name: 'Acme Care Group', typeLabel: t }), t).toBeNull();
  });
});
