import { it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/authz', () => ({ authorizeResource: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/stripe', () => ({
  syncVoicePriceForTenant: vi.fn().mockResolvedValue(undefined),
  ensureTierItemForTenant: vi.fn().mockResolvedValue({ status: 'added', itemId: 'si_1' }),
  ensureExpertBackupItemForTenant: vi.fn().mockResolvedValue({ status: 'added', itemId: 'si_eb' }),
}));

vi.mock('@/lib/tierBilling', () => ({ tierBillingConfigured: () => true }));
import { getSupabaseAdmin } from '@/lib/supabase';
import { ensureTierItemForTenant, ensureExpertBackupItemForTenant, syncVoicePriceForTenant } from '@/lib/stripe';
import { POST } from '@/app/api/agents/[id]/versions/route';

let calendarRow: unknown;
let inserts: string[];

function supabaseMock() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      let op = '';
      for (const m of ['select', 'eq', 'order', 'limit', 'in']) b[m] = () => b;
      b.insert = () => { op = 'insert'; inserts.push(table); return b; };
      const result = () => {
        if (table === 'calldesk_calendar_connections') return { data: calendarRow, error: null };
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

async function post(nodes: unknown, extra: Record<string, unknown> = {}) {
  const req = new NextRequest('http://localhost/api/agents/a1/versions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowName: 'v1', startNodeId: 'greet', nodes, voiceEngine: 'poc', ...extra }),
  });
  return POST(req, { params: Promise.resolve({ id: 'a1' }) });
}

beforeEach(() => {
  calendarRow = null; inserts = [];
  vi.clearAllMocks();
  vi.mocked(getSupabaseAdmin).mockReturnValue(supabaseMock() as never);
});

it('requireBookingTools + intent + no calendar => 422, nothing written, no Stripe call', async () => {
  const res = await post(bookingNodes, { requireBookingTools: true, tier: 'standard' });
  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.code).toBe('booking_requires_calendar');
  expect(body.error).toMatch(/no calendar is connected/);
  expect(body.reasons.length).toBeGreaterThan(0);
  expect(body.fix).toMatch(/Connect a calendar under Integrations.*without requireBookingTools/);
  expect(inserts).toEqual([]);
  expect(ensureTierItemForTenant).not.toHaveBeenCalled();
  expect(ensureExpertBackupItemForTenant).not.toHaveBeenCalled();
  expect(syncVoicePriceForTenant).not.toHaveBeenCalled();
});

it('requireBookingTools + calendar connected => 201 without warnings', async () => {
  calendarRow = { id: 'c1' };
  const res = await post(bookingNodes, { requireBookingTools: true });
  expect(res.status).toBe(201);
  expect(await res.json()).not.toHaveProperty('warnings');
});

it('requireBookingTools + calendarTools false => 422 with the calendar-tools-off message, even with a calendar', async () => {
  calendarRow = { id: 'c1' };
  const res = await post(bookingNodes, { requireBookingTools: true, globalSettings: { calendarTools: false } });
  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.code).toBe('booking_requires_calendar');
  expect(body.error).toMatch(/turned off/);
  expect(inserts).toEqual([]);
});

it('default (flag absent or false) still publishes with a warning', async () => {
  for (const extra of [{}, { requireBookingTools: false }]) {
    const res = await post(bookingNodes, extra);
    expect(res.status).toBe(201);
    expect((await res.json()).warnings).toEqual([expect.objectContaining({ code: 'booking_without_calendar' })]);
  }
});

it('requireBookingTools without booking intent => 201', async () => {
  const res = await post(faqNodes, { requireBookingTools: true });
  expect(res.status).toBe(201);
  expect(await res.json()).not.toHaveProperty('warnings');
});

it('a non-boolean requireBookingTools is a 400', async () => {
  const res = await post(bookingNodes, { requireBookingTools: 'yes' });
  expect(res.status).toBe(400);
  expect(inserts).toEqual([]);
});

it('MCP publish_agent_version declares requireBookingTools as an optional boolean and documents it', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/mcp/tools.ts'), 'utf8');
  const publish = src.slice(src.indexOf("registerTool('publish_agent_version'"), src.indexOf("registerTool('list_pricing_tiers'"));
  expect(publish).toMatch(/requireBookingTools: z\.boolean\(\)\.optional\(\)\.describe\(/);
  expect(publish).toMatch(/requireBookingTools: true/);
  expect(publish).toMatch(/booking_requires_calendar/);
  const tpl = src.slice(src.indexOf("registerTool('create_agent_from_template'"), src.indexOf("registerTool('get_call'"));
  expect(tpl).toMatch(/publishWarnings/);
});
