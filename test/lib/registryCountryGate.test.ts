import { describe, it, expect } from 'vitest';
import { registryCountryAllowed } from '@/lib/outreach/discovery/registryCommon';
import { BRREG_ORG_FORMS } from '@/lib/outreach/discovery/noBrregEnheter';

describe('register loads only produce US and Canadian leads', () => {
  it('allows US, Canada and unlabelled (domestic) candidates', () => {
    expect(registryCountryAllowed(undefined, {})).toBe(true);
    expect(registryCountryAllowed('', {})).toBe(true);
    expect(registryCountryAllowed('US', {})).toBe(true);
    expect(registryCountryAllowed('ca', {})).toBe(true);
  });

  it('drops every other country, including Norway', () => {
    for (const c of ['NO', 'FR', 'GB', 'DE', 'BR']) expect(registryCountryAllowed(c, {})).toBe(false);
  });

  it('can be lifted deliberately with ALLOW_INTL_REGISTRY=1', () => {
    expect(registryCountryAllowed('NO', { ALLOW_INTL_REGISTRY: '1' })).toBe(true);
  });

  it('the Norwegian loader never queries sole proprietorships (ENK)', () => {
    expect(BRREG_ORG_FORMS).not.toContain('ENK');
  });
});
