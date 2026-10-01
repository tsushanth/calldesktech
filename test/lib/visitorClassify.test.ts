import { describe, it, expect } from 'vitest';
import { classifyVisitor, ipMatches, summarize, type VisitorRow, type ClassifyConfig } from '@/lib/visitors/classify';

const cfg: ClassifyConfig = { internalIps: ['73.15.245.31', '2601:647:6801:7e70:*'], botIps: ['9.9.9.*'], adminEmails: ['owner@example.com'] };

function row(over: Partial<VisitorRow> = {}): VisitorRow {
  return {
    ip: '98.1.2.3', country: 'US', city: 'Austin', os: 'Mac OS X', device: 'Desktop', browser: 'Chrome',
    userAgent: 'Mozilla/5.0 (Macintosh) Chrome/150', referrer: '$direct', pageviews: 1, paths: ['/'],
    heroStarted: 0, demoCalls: 0, setupActions: 0, email: null,
    firstSeen: '2026-09-30T10:00:00Z', lastSeen: '2026-09-30T10:00:00Z', firstPageview: '2026-09-30T10:00:00Z', lastPageview: '2026-09-30T10:00:00Z',
    ...over,
  };
}

describe('ipMatches', () => {
  it('matches exact addresses and trailing-* prefixes only', () => {
    expect(ipMatches(['1.2.3.4'], '1.2.3.4')).toBe(true);
    expect(ipMatches(['1.2.3.4'], '1.2.3.45')).toBe(false);
    expect(ipMatches(['2601:647:6801:7e70:*'], '2601:647:6801:7e70:ad9f:1:2:3')).toBe(true);
    expect(ipMatches(['2601:647:6801:7e70:*'], '2601:647:6801:9999::1')).toBe(false);
    expect(ipMatches(['*'], '1.2.3.4')).toBe(true); // an explicit bare * means everything, as configured
    expect(ipMatches([''], '1.2.3.4')).toBe(false);
  });
});

describe('classifyVisitor', () => {
  it('marks our own networks, admin emails and test browsers as internal', () => {
    expect(classifyVisitor(row({ ip: '73.15.245.31' }), cfg).kind).toBe('internal');
    expect(classifyVisitor(row({ ip: '2601:647:6801:7e70:ad9f:d240:11dd:b422' }), cfg).kind).toBe('internal');
    expect(classifyVisitor(row({ email: 'Owner@Example.com' }), cfg).kind).toBe('internal');
    expect(classifyVisitor(row({ userAgent: 'Mozilla/5.0 HeadlessChrome/150' }), cfg).kind).toBe('internal');
  });

  it('marks crawlers, API fetches, bursts and data-center networks as automated', () => {
    expect(classifyVisitor(row({ userAgent: 'facebookexternalhit/1.1' }), cfg).kind).toBe('automated');
    expect(classifyVisitor(row({ paths: ['/api/v1/openapi.json'] }), cfg).kind).toBe('automated');
    const burst = row({ pageviews: 3, paths: ['/', '/unsubscribe/abc', '/deck'], firstPageview: '2026-09-28T23:40:31.655Z', lastPageview: '2026-09-28T23:40:33.400Z' });
    expect(classifyVisitor(burst, cfg).kind).toBe('automated');
    expect(classifyVisitor(row({ ip: '135.232.20.87' }), cfg).kind).toBe('automated');
    expect(classifyVisitor(row({ ip: '9.9.9.7' }), cfg).kind).toBe('automated'); // from ANALYTICS_BOT_IPS
  });

  it('does not call a quick burst automated when the visitor tried the demo', () => {
    const v = row({ pageviews: 4, paths: ['/', '/demo'], heroStarted: 1, firstPageview: '2026-09-30T10:00:00Z', lastPageview: '2026-09-30T10:00:02Z' });
    expect(classifyVisitor(v, cfg).kind).toBe('human');
  });

  it('separates unsubscribe-link opens from people', () => {
    expect(classifyVisitor(row({ paths: ['/unsubscribe/abc123'] }), cfg).kind).toBe('unsubscribe');
    expect(classifyVisitor(row({ paths: ['/unsubscribe/abc123', '/'], pageviews: 2, lastPageview: '2026-09-30T10:05:00Z' }), cfg).kind).toBe('human');
  });

  it('flags engaged people: 3+ pages, a demo action, or an identified email', () => {
    expect(classifyVisitor(row(), cfg).engaged).toBe(false);
    expect(classifyVisitor(row({ pageviews: 3, paths: ['/', '/pricing', '/demo'], lastPageview: '2026-09-30T10:10:00Z' }), cfg).engaged).toBe(true);
    expect(classifyVisitor(row({ demoCalls: 1 }), cfg).engaged).toBe(true);
    expect(classifyVisitor(row({ email: 'lead@company.com' }), cfg).engaged).toBe(true);
    expect(classifyVisitor(row({ ip: '73.15.245.31', pageviews: 10 }), cfg).engaged).toBe(false); // never for ours
  });
});

describe('summarize', () => {
  it('counts each kind and the demo starters among people only', () => {
    const rows = [
      classifyVisitor(row({ ip: '73.15.245.31', heroStarted: 3 }), cfg),
      classifyVisitor(row({ ip: '135.232.1.1' }), cfg),
      classifyVisitor(row({ ip: '98.0.0.1', heroStarted: 1 }), cfg),
      classifyVisitor(row({ ip: '98.0.0.2', demoCalls: 2 }), cfg),
      classifyVisitor(row({ ip: '98.0.0.3', paths: ['/unsubscribe/x'] }), cfg),
    ];
    expect(summarize(rows)).toMatchObject({ total: 5, internal: 1, automated: 1, human: 2, unsubscribe: 1, heroStarted: 1, demoCalls: 1, engaged: 2 });
  });
});
