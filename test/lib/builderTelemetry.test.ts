import { describe, it, expect } from 'vitest';
import { errorProps } from '@/lib/builderTelemetry';

describe('errorProps', () => {
  it('keeps only the first line and caps its length', () => {
    const r = errorProps(new Error(`Validation failed\nprompt: ${'x'.repeat(500)}`), 400);
    expect(r).toEqual({ error: 'Validation failed', status: 400 });
    expect(errorProps('a'.repeat(300)).error).toHaveLength(160);
  });
  it('handles non-errors and omits status when unknown', () => {
    expect(errorProps(undefined)).toEqual({ error: 'unknown' });
    expect(errorProps(42)).toEqual({ error: 'unknown' });
    expect('status' in errorProps(new Error('x'))).toBe(false);
  });
});
