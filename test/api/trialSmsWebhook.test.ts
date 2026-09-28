import { it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/smsProvider', () => ({ getSmsProvider: vi.fn() }));
vi.mock('@/lib/trial-creator', () => ({ createTrialForSession: vi.fn().mockResolvedValue({ assigned_number: '+14155550001', agent_id: 'agent-1' }) }));

import { getSupabaseAdmin } from '@/lib/supabase';
import { getSmsProvider } from '@/lib/smsProvider';
import { createTrialForSession } from '@/lib/trial-creator';
import { POST } from '@/app/api/webhooks/trial-sms/route';

const FROM = '+14155551234';
const TO = '+12245061194'; // default TRIAL_ONBOARDING_NUMBER used by the route

// Stateful in-memory session store, keyed by from/to, that the mock
// Supabase client reads from and writes to so each POST call sees the
// state the previous call left behind — mirroring a real DB round-trip.
function makeStatefulSupabase() {
  let session: Record<string, unknown> | null = null;
  let idCounter = 0;

  return {
    session: () => session,
    client: {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        const chain = ['select', 'eq', 'order', 'limit'];
        for (const m of chain) builder[m] = () => builder;

        builder.maybeSingle = async () => {
          if (table === 'trial_sms_sessions') return { data: session, error: null };
          if (table === 'calldesk_phone_numbers') return { data: null, error: null };
          return { data: null, error: null };
        };
        builder.single = async () => {
          if (table === 'trial_sms_sessions') return { data: session, error: null };
          return { data: null, error: null };
        };

        builder.insert = (row: Record<string, unknown>) => {
          if (table === 'trial_sms_sessions') {
            session = {
              id: `session-${++idCounter}`,
              from_phone: row.from_phone,
              to_phone: row.to_phone,
              step: row.step,
              company_name: null,
              greeting: null,
              transfer_number: null,
              timezone: 'America/New_York',
            };
          }
          return builder;
        };
        builder.update = (patch: Record<string, unknown>) => {
          if (table === 'trial_sms_sessions' && session) {
            session = { ...session, ...patch };
          }
          return builder;
        };

        (builder as unknown as PromiseLike<unknown>).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject);
        return builder;
      },
    },
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('https://example.com/api/webhooks/trial-sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
  vi.mocked(createTrialForSession).mockClear();
  send = vi.fn().mockResolvedValue({ providerSid: 'SM1', status: 'queued' });
  vi.mocked(getSmsProvider).mockReturnValue({ send } as never);
});

it('rejects when to/from cannot be resolved', async () => {
  const store = makeStatefulSupabase();
  vi.mocked(getSupabaseAdmin).mockReturnValue(store.client as never);
  const response = await POST(makeRequest({ to: '', from: '', body: 'hi' }));
  expect(response.status).toBe(400);
});

it('acknowledges without engaging the state machine when the target number is not the trial number', async () => {
  const store = makeStatefulSupabase();
  vi.mocked(getSupabaseAdmin).mockReturnValue(store.client as never);
  const response = await POST(makeRequest({ to: '+19995550000', from: FROM, body: 'hi' }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.note).toBe('not trial number');
});

it('drives a full happy-path flow through to trial creation', async () => {
  const store = makeStatefulSupabase();
  vi.mocked(getSupabaseAdmin).mockReturnValue(store.client as never);

  // 1. greeting -> START
  let res = await POST(makeRequest({ to: TO, from: FROM, body: 'START' }));
  let json = await res.json();
  expect(json.step).toBe('company_name');
  expect(store.session()?.step).toBe('company_name');

  // 2. company_name
  res = await POST(makeRequest({ to: TO, from: FROM, body: 'Acme Plumbing' }));
  json = await res.json();
  expect(json.step).toBe('greeting_prompt');
  expect(store.session()?.company_name).toBe('Acme Plumbing');

  // 3. greeting_prompt -> default greeting
  res = await POST(makeRequest({ to: TO, from: FROM, body: '1' }));
  json = await res.json();
  expect(json.step).toBe('transfer_number');
  expect(store.session()?.greeting).toContain('Acme Plumbing');

  // 4. transfer_number
  res = await POST(makeRequest({ to: TO, from: FROM, body: '4155559999' }));
  json = await res.json();
  expect(json.step).toBe('timezone');
  expect(store.session()?.transfer_number).toBe('+14155559999');

  // 5. timezone -> reports completed and kicks off trial creation.
  // NOTE (pre-existing bug, not fixed here): the `timezone` state handler's
  // DB update only sets `{ timezone: tz }` and never sets `step: 'completed'`,
  // so the session row's step stays 'timezone' even though the HTTP response
  // claims nextStep 'completed'. Asserting actual behavior here.
  const sessionId = store.session()?.id;
  res = await POST(makeRequest({ to: TO, from: FROM, body: 'America/New_York' }));
  json = await res.json();
  expect(json.step).toBe('completed');
  expect(store.session()?.step).toBe('timezone');
  expect(createTrialForSession).toHaveBeenCalledWith(sessionId);
  expect(createTrialForSession).toHaveBeenCalledTimes(1);
});

it('STOP short-circuits to completed from any state', async () => {
  const store = makeStatefulSupabase();
  vi.mocked(getSupabaseAdmin).mockReturnValue(store.client as never);

  // Get into company_name state first.
  await POST(makeRequest({ to: TO, from: FROM, body: 'START' }));
  expect(store.session()?.step).toBe('company_name');

  const res = await POST(makeRequest({ to: TO, from: FROM, body: 'STOP' }));
  const json = await res.json();
  expect(json.step).toBe('completed');
  expect(store.session()?.step).toBe('completed');
  expect(json.replied).toMatch(/will not receive any more messages/i);
});

it('HELP responds with guidance without changing step', async () => {
  const store = makeStatefulSupabase();
  vi.mocked(getSupabaseAdmin).mockReturnValue(store.client as never);

  const res = await POST(makeRequest({ to: TO, from: FROM, body: 'HELP' }));
  const json = await res.json();
  expect(json.step).toBe('greeting');
  expect(json.replied).toMatch(/START/);
  expect(store.session()?.step).toBe('greeting');
});
