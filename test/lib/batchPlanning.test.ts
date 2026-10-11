import { describe, it, expect } from 'vitest';
import { selectRetries, dealWithQuotas, orderWithRetries, type PreviousRow } from '@/lib/batchPlanning';

const row = (p: Partial<PreviousRow> & { phone: string }): PreviousRow => ({
  sip_username: 'mary', lead_id: null, company_name: 'Co', state: 'TX', attempt: 1, outcome: 'voicemail', ...p,
});

describe('selectRetries', () => {
  const none = { blocked: new Set<string>(), alreadyRetried: new Set<string>(), maxPerCaller: 10 };
  it('retries only first-attempt voicemails', () => {
    const rows = [row({ phone: '+1a' }), row({ phone: '+1b', outcome: 'no_answer' }), row({ phone: '+1c', attempt: 2 }), row({ phone: '+1d', outcome: null })];
    expect(selectRetries(rows, none).map((r) => r.phone)).toEqual(['+1a']);
  });
  it('skips blocked numbers and numbers already retried', () => {
    const rows = [row({ phone: '+1a' }), row({ phone: '+1b' }), row({ phone: '+1c' })];
    const r = selectRetries(rows, { ...none, blocked: new Set(['+1a']), alreadyRetried: new Set(['+1b']) });
    expect(r.map((x) => x.phone)).toEqual(['+1c']);
  });
  it('keeps the same caller and caps retries per caller', () => {
    const rows = [row({ phone: '+1a' }), row({ phone: '+1b' }), row({ phone: '+1c' }), row({ phone: '+1d', sip_username: 'mark' })];
    const r = selectRetries(rows, { ...none, maxPerCaller: 2 });
    expect(r.filter((x) => x.sip_username === 'mary').map((x) => x.phone)).toEqual(['+1a', '+1b']);
    expect(r.filter((x) => x.sip_username === 'mark')).toHaveLength(1);
  });
  it('never returns the same number twice', () => {
    expect(selectRetries([row({ phone: '+1a' }), row({ phone: '+1a', sip_username: 'mark' })], none)).toHaveLength(1);
  });
});

describe('dealWithQuotas', () => {
  it('splits evenly when quotas are equal', () => {
    const d = dealWithQuotas([1, 2, 3, 4, 5, 6], ['mary', 'mark'], { mary: 3, mark: 3 });
    expect(d.mary).toHaveLength(3);
    expect(d.mark).toHaveLength(3);
  });
  it('gives a caller with fewer open slots proportionally fewer', () => {
    const d = dealWithQuotas([1, 2, 3, 4, 5, 6, 7, 8], ['mary', 'mark'], { mary: 2, mark: 6 });
    expect(d.mary).toHaveLength(2);
    expect(d.mark).toHaveLength(6);
  });
  it('stops when every quota is full', () => {
    const d = dealWithQuotas([1, 2, 3, 4], ['mary', 'mark'], { mary: 1, mark: 1 });
    expect(d.mary.length + d.mark.length).toBe(2);
  });
});

describe('orderWithRetries', () => {
  it('puts morning-first-try retries at the end and afternoon ones at the start', () => {
    const fresh = [{ id: 'f1' }, { id: 'f2' }];
    const retries = [{ id: 'amRetry', hourET: 11 }, { id: 'pmRetry', hourET: 15 }, { id: 'unknown', hourET: null }];
    expect(orderWithRetries(fresh, retries).map((x) => x.id)).toEqual(['pmRetry', 'unknown', 'f1', 'f2', 'amRetry']);
  });
});

describe('shiftWindow (evening Pacific shift, 5 PM to 10 PM PDT)', async () => {
  const { shiftWindow } = await import('@/lib/batchPlanning');
  const start = new Date('2026-10-13T00:00:00Z'); // Monday 5 PM PDT
  it('Pacific is open about 4 hours, Eastern about 1, and the close order is east to west', () => {
    const ca = shiftWindow('CA', start, 5), tx = shiftWindow('TX', start, 5), ny = shiftWindow('NY', start, 5), co = shiftWindow('CO', start, 5);
    expect(ca.openMin).toBeGreaterThanOrEqual(235); expect(ca.openMin).toBeLessThanOrEqual(245);
    expect(ny.openMin).toBeGreaterThanOrEqual(55); expect(ny.openMin).toBeLessThanOrEqual(65);
    expect(ny.closeAt).toBeLessThan(tx.closeAt); expect(tx.closeAt).toBeLessThan(co.closeAt); expect(co.closeAt).toBeLessThan(ca.closeAt);
  });
  it('a Sunday-evening Pacific shift is closed everywhere in the US', () => {
    expect(shiftWindow('CA', new Date('2026-10-12T00:00:00Z'), 5).openMin).toBe(0); // Sunday 5 PM PDT
  });
});
