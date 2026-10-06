import { describe, it, expect } from 'vitest';
import { classifyRegion, factsFromPages } from '@/lib/outreach/callRegion';

const site = (body: string, lang = 'en') => factsFromPages([`<html lang="${lang}"><body>${body}</body></html>`]);

describe('classifyRegion', () => {
  it('confirms a number shown as +1 on the site', () => {
    expect(classifyRegion(site('Call +1 (415) 715-9656 today'), { phone: '4157159656' }).verdict).toBe('us_confirmed');
  });
  it('calls a Canadian area code ca_confirmed', () => {
    expect(classifyRegion(site('Reach us: +1 416 555 0100'), { phone: '4165550100' }).verdict).toBe('ca_confirmed');
  });
  it('rejects a bare foreign mobile whose digits appear under +91', () => {
    const r = classifyRegion(site('WhatsApp +91 7816042887'), { phone: '7816042887' });
    expect(r.verdict).toBe('foreign_number');
  });
  it('flags a number shared by three unrelated leads as junk', () => {
    expect(classifyRegion(site('hello'), { phone: '2633112223' }, 4).verdict).toBe('bad_number');
  });
  it('is likely-US on an English site with US signals even when the business is abroad', () => {
    const r = classifyRegion(site('We serve clients across the United States. Plans from $99 per month.'), { phone: '3125550100', location: 'Mumbai, India' });
    expect(r.verdict).toBe('us_likely');
  });
  it('is likely-Canada when the site is mostly Canadian', () => {
    expect(classifyRegion(site('Canadian business in Toronto, Ontario. Proudly Canadian, serving Canada.'), { phone: '4165550100' }).verdict).toBe('ca_likely');
  });
  it('is unclear with nothing to go on', () => {
    expect(classifyRegion(site('Welcome to our studio.'), { phone: '5125550100' }).verdict).toBe('unclear');
  });
  it('does not treat a non-English site as US-likely on prices alone', () => {
    expect(classifyRegion(site('Precios desde $10 $20 $30 $40 $50', 'es'), { phone: '5125550100' }).verdict).toBe('unclear');
  });
});
