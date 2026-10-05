import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeResource: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/stripe', () => ({
  syncVoicePriceForTenant: vi.fn().mockResolvedValue(undefined),
  ensureTierItemForTenant: vi.fn().mockResolvedValue({ status: 'added', itemId: 'si_1' }),
  ensureExpertBackupItemForTenant: vi.fn().mockResolvedValue({ status: 'added', itemId: 'si_eb' }),
}));

import { getSupabaseAdmin } from '@/lib/supabase';
import { POST } from '@/app/api/agents/[id]/versions/route';

let calendarRow: unknown;
let calendarQueries: number;
let calendarError: unknown;

function supabaseMock() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      let op = '';
      for (const m of ['select', 'eq', 'order', 'limit', 'in']) b[m] = () => b;
      b.insert = () => { op = 'insert'; return b; };
      const result = () => {
        if (table === 'calldesk_calendar_connections') { calendarQueries += 1; return { data: calendarRow, error: calendarError }; }
        if (table === 'calldesk_agents') return { data: { tenant_id: 't1' }, error: null };
        if (table === 'calldesk_conversation_flows') return { data: { id: 'flow1' }, error: null };
        if (table === 'calldesk_agent_versions' && op === 'insert') return { data: { id: 'v1' }, error: null };
        return { data: null, error: null };
      };
      b.single = async () => result();
      b.maybeSingle = async () => result();
      return b;
    },
  };
}

const bookingNodes = [
  { id: 'greet', type: 'greeting', prompt: 'Greet the caller for Cedar Dental.', edges: [{ id: 'e', target: 'collect', condition: 'wants a cleaning' }] },
  { id: 'collect', type: 'extraction', prompt: 'Collect name and preferred day.', extract: { name: 'string', preferred_time: 'string' }, edges: [] },
];
const faqNodes = [{ id: 'greet', type: 'greeting', prompt: 'Answer questions about opening hours.', edges: [] }];

async function post(nodes: unknown, globalSettings?: unknown) {
  const req = new NextRequest('http://localhost/api/agents/a1/versions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowName: 'v1', startNodeId: 'greet', nodes, voiceEngine: 'poc', ...(globalSettings ? { globalSettings } : {}) }),
  });
  return POST(req, { params: Promise.resolve({ id: 'a1' }) });
}

beforeEach(() => {
  calendarRow = null; calendarError = null; calendarQueries = 0;
  vi.mocked(getSupabaseAdmin).mockReturnValue(supabaseMock() as never);
});

it('warns (without failing) when the flow collects appointments and no calendar is connected', async () => {
  const res = await post(bookingNodes);
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.version).toBeTruthy();
  expect(body.warnings).toEqual([expect.objectContaining({ code: 'booking_without_calendar', message: expect.stringMatching(/no calendar is connected/) })]);
});

it('no warning when a calendar is connected', async () => {
  calendarRow = { id: 'c1' };
  const body = await (await post(bookingNodes)).json();
  expect(body).not.toHaveProperty('warnings');
});

it('warns that calendar tools are off even when a calendar is connected, without querying', async () => {
  calendarRow = { id: 'c1' };
  const body = await (await post(bookingNodes, { calendarTools: false })).json();
  expect(body.warnings[0].message).toMatch(/turned off/);
  expect(calendarQueries).toBe(0);
});

it('a flow with no booking intent never queries the calendar table', async () => {
  const body = await (await post(faqNodes)).json();
  expect(body).not.toHaveProperty('warnings');
  expect(calendarQueries).toBe(0);
});

it('a missing calendar table still publishes (warns, as not connected)', async () => {
  calendarError = { code: '42P01', message: 'relation does not exist' };
  const res = await post(bookingNodes);
  expect(res.status).toBe(201);
  expect((await res.json()).warnings).toHaveLength(1);
});
