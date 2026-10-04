import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeDb } from '../helpers/fakeDb';

let db = makeDb({});
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => db }));
vi.mock('@/lib/authz', () => ({ authorizeTenant: async () => ({ ok: true, tenantId: 'T' }) }));

import { GET as analyticsGET } from '@/app/api/tenants/[id]/analytics/route';
import { GET as qaOverviewGET } from '@/app/api/tenants/[id]/qa/overview/route';
import { GET as statsGET } from '@/app/api/tenants/[id]/stats/route';

const ctx = { params: Promise.resolve({ id: 'T' }) };
const get = (url: string) => new NextRequest(`http://localhost${url}`);
const now = new Date().toISOString();
const blocked = (id: string) => ({ id, tenant_id: 'T', created_at: now, outcome: 'abandoned', duration_seconds: 0, analysis: { blocked: 'pilot' }, qa_status: null, qa_score: null, transfer_status: null });
const real = (id: string, outcome: string, dur: number) => ({ id, tenant_id: 'T', created_at: now, outcome, duration_seconds: dur, analysis: { summary: 's' }, qa_status: null, qa_score: null, transfer_status: null });

function seed() {
  db = makeDb({
    calldesk_call_logs: [real('1', 'booked', 100), real('2', 'answered', 60), real('3', 'abandoned', 5), blocked('4'), blocked('5'), blocked('6')],
    calldesk_bookings: [],
  });
}

describe('pilot-blocked calls stay out of customer-facing analytics', () => {
  it('analytics: totals, outcome mix and abandoned count exclude them', async () => {
    seed();
    const body = await (await analyticsGET(get('/api/tenants/T/analytics'), ctx)).json();
    expect(body.totalCalls).toBe(3);
    const mix = Object.fromEntries(body.outcomes.map((o: { outcome: string; count: number }) => [o.outcome, o.count]));
    expect(mix.abandoned).toBe(1); // the one real abandoned call, not the 3 blocked ones
    expect(mix.booked).toBe(1);
    expect(body.byHour.reduce((s: number, h: { calls: number }) => s + h.calls, 0)).toBe(3);
  });

  it('quality assurance: resolution rate is over real calls only', async () => {
    seed();
    const body = await (await qaOverviewGET(get('/api/tenants/T/qa/overview'), ctx)).json();
    expect(body.totalCalls).toBe(3);
    expect(body.resolutionRate).toBeCloseTo(66.7, 1); // 2 of 3, not 2 of 6
  });

  it('stats: counts and average duration exclude them', async () => {
    seed();
    const body = await (await statsGET(get('/api/tenants/T/stats'), ctx)).json();
    expect(body.totalCalls).toBe(3);
    expect(body.avgDuration).toBe(55); // (100+60+5)/3, not diluted by zero-second blocked calls
  });
});
