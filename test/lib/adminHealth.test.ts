import { describe, it, expect } from 'vitest';
import { overall, integrationStatus, type Check } from '@/lib/admin/health';
import { internalTenantIds } from '@/lib/admin/internal';
import { attentionItems, lastDays, ago, type Overview } from '@/lib/admin/overview';

const c = (level: Check['level']): Check => ({ name: 'x', level, detail: '' });

describe('overall', () => {
  it('worst level wins, and an unconfigured service is not an outage', () => {
    expect(overall([c('ok'), c('off')])).toBe('ok');
    expect(overall([c('ok'), c('warn')])).toBe('warn');
    expect(overall([c('warn'), c('down'), c('ok')])).toBe('down');
  });
});

describe('integrationStatus', () => {
  it('reports missing variable names but never their values', () => {
    const r = integrationStatus({ TWILIO_ACCOUNT_SID: 'ACsecret', ANTHROPIC_API_KEY: 'sk-secret' });
    expect(r.find((x) => x.name.startsWith('Twilio'))).toMatchObject({ level: 'off', detail: 'missing TWILIO_AUTH_TOKEN' });
    expect(r.find((x) => x.name.startsWith('Anthropic'))).toMatchObject({ level: 'ok', detail: 'configured' });
    expect(JSON.stringify(r)).not.toMatch(/ACsecret|sk-secret/);
  });
});

describe('integrationStatus: built-in defaults', () => {
  it('reports the failure reporter as on when its variables are unset, because the code has built-in defaults', () => {
    expect(integrationStatus({}).find((x) => x.name === 'Failure reporter')).toMatchObject({ level: 'ok', detail: 'configured (built-in defaults)' });
    expect(integrationStatus({ FAILURE_REPORTER_URL: 'u', FAILURE_REPORTER_KEY: 'k' }).find((x) => x.name === 'Failure reporter')).toMatchObject({ level: 'ok', detail: 'configured' });
  });
});

const base: Overview = {
  ours: { calls30: 0, workspaces: 0 },
  totals: { users: 0, workspaces: 0, agents: 0, callsAllTime: 0 },
  calls: { h24: 0, d7: 0, d30: 0, minutes7: 0, lastCallAt: null, byOutcome: {} },
  signupsByDay: [], sms: { h24: 0, failed24: 0 },
  outreach: { lastSentAt: null, approvedQueue: 0, sent7: 0, hardBounces7: 0, complaints7: 0, lastRun: null, stuckRuns: 0 },
  signals: [],
};

describe('attentionItems', () => {
  it('is empty when everything is quiet', () => expect(attentionItems(base)).toEqual([]));
  it('flags complaints, high bounce rate, failed texts and stuck runs', () => {
    const o: Overview = { ...base, sms: { h24: 5, failed24: 2 }, outreach: { ...base.outreach, sent7: 40, hardBounces7: 4, complaints7: 1, stuckRuns: 2 } };
    const items = attentionItems(o).join(' | ');
    expect(items).toMatch(/spam complaint/);
    expect(items).toMatch(/bounce rate is 10%/);
    expect(items).toMatch(/2 of 5 text messages failed/);
    expect(items).toMatch(/2 outreach discovery run/);
  });
  it('ignores a bounce rate on a tiny sample', () => {
    expect(attentionItems({ ...base, outreach: { ...base.outreach, sent7: 5, hardBounces7: 2 } })).toEqual([]);
  });
});

describe('helpers', () => {
  it('lastDays returns n consecutive UTC days ending today', () => {
    const d = lastDays(3, Date.parse('2026-10-01T12:00:00Z'));
    expect(d).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  });
  it('ago handles null and ranges', () => {
    expect(ago(null)).toBe('never');
    expect(ago(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3 h ago');
  });
});

describe('internalTenantIds', () => {
  it('treats admin-owned and demo workspaces as ours, customer workspaces as theirs', () => {
    const users = [{ id: 'u1', email: 'T.Sushanth@gmail.com' }, { id: 'u2', email: 'owner@customer.com' }];
    const tenants = [
      { id: 'a', user_id: 'u1' }, { id: 'b', user_id: 'u2' }, { id: 'c', user_id: 'demo_xyz' }, { id: 'd', user_id: null },
    ];
    expect([...internalTenantIds(tenants, users, ['t.sushanth@gmail.com'])].sort()).toEqual(['a', 'c', 'd']);
  });
});
