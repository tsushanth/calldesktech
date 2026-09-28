import { it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/smsProvider', () => ({ getSmsProvider: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getSmsProvider } from '@/lib/smsProvider';
import { createTrialForSession } from '@/lib/trial-creator';

// buildFlow() itself is not exported, so we drive it indirectly through
// createTrialForSession and capture the flow it POSTs to the versions
// endpoint — this is a regression test for a real bug where generated
// flow nodes were missing their `edges` array.

function makeSupabaseMock(session: Record<string, unknown>) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'update']) builder[m] = () => builder;
      builder.single = async () => (table === 'trial_sms_sessions' ? { data: session, error: null } : { data: null, error: null });
      (builder as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject);
      return builder;
    },
  };
}

const ORIGINAL_FETCH = global.fetch;
let capturedVersionBody: any = null;

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(getSmsProvider).mockReset();
  vi.mocked(getSmsProvider).mockReturnValue({ send: vi.fn().mockResolvedValue({ providerSid: null, status: 'queued' }) } as never);
  capturedVersionBody = null;

  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    if (u.endsWith('/me')) {
      return new Response(JSON.stringify({ tenantId: 'tenant-1' }), { status: 200 });
    }
    if (u.endsWith('/agents')) {
      return new Response(JSON.stringify({ id: 'agent-1' }), { status: 200 });
    }
    if (u.includes('/agents/') && u.endsWith('/versions')) {
      capturedVersionBody = body;
      return new Response(JSON.stringify({ id: 'version-1' }), { status: 200 });
    }
    if (u.endsWith('/phone-numbers/purchase')) {
      return new Response(JSON.stringify({ id: 'phone-1', number: '+14155550001' }), { status: 200 });
    }
    if (u.includes('/routing')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error(`Unexpected fetch to ${u}`);
  }) as never;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

it('every node in the generated flow has an edges array', async () => {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    makeSupabaseMock({
      id: 'session-1',
      company_name: 'Acme Plumbing',
      greeting: null,
      transfer_number: '+14155559999',
      timezone: 'America/New_York',
      from_phone: 'web',
    }) as never
  );

  const result = await createTrialForSession('session-1');

  expect(result.assigned_number).toBe('+14155550001');
  expect(capturedVersionBody).toBeTruthy();
  expect(Array.isArray(capturedVersionBody.nodes)).toBe(true);
  expect(capturedVersionBody.nodes.length).toBeGreaterThan(0);
  for (const node of capturedVersionBody.nodes) {
    expect(Array.isArray(node.edges)).toBe(true);
  }
  // Terminal nodes (transfer, goodbye) should have empty edges; non-terminal
  // nodes should have at least one.
  const transfer = capturedVersionBody.nodes.find((n: any) => n.id === 'transfer');
  expect(transfer.edges).toEqual([]);
  const greeting = capturedVersionBody.nodes.find((n: any) => n.id === 'greeting');
  expect(greeting.edges.length).toBeGreaterThan(0);
});
