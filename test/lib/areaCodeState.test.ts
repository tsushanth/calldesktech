import { describe, it, expect } from 'vitest';
import { stateFromPhone } from '@/lib/areaCodeState';

describe('stateFromPhone', () => {
  it('reads US numbers in any stored format', () => {
    expect(stateFromPhone('+14256284887')).toBe('WA');
    expect(stateFromPhone('(512) 555-0100')).toBe('TX');
    expect(stateFromPhone('1-212-555-0100')).toBe('NY');
    expect(stateFromPhone('+1 305 555 0100')).toBe('FL');
  });
  it('never reads a foreign number as a US one', () => {
    expect(stateFromPhone('+47 22 33 44 55')).toBeNull();
    expect(stateFromPhone('+372 5123 4567')).toBeNull();
    expect(stateFromPhone('0044 20 7946 0958')).toBeNull();
  });
  it('reads Canadian numbers as provinces', () => {
    expect(stateFromPhone('+1 416 555 0100')).toBe('ON');
    expect(stateFromPhone('604-555-0100')).toBe('BC');
  });
  it('returns null for the Caribbean, unknown codes and junk', () => {
    expect(stateFromPhone('+1 242 555 0100')).toBeNull();
    expect(stateFromPhone('555')).toBeNull();
    expect(stateFromPhone(null)).toBeNull();
  });
});
