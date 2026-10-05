import { it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: vi.fn() }));

import { POST as voice } from '@/app/api/twilio/outbound-voice/route';
import { POST as status } from '@/app/api/twilio/outbound-status/route';

const empty = (path: string) => new NextRequest(`https://example.com${path}`, { method: 'POST' });

it('outbound-voice answers a non-form body with 400, not a 500', async () => {
  expect((await voice(empty('/api/twilio/outbound-voice'))).status).toBe(400);
});

it('outbound-status answers a non-form body with 400, not a 500', async () => {
  expect((await status(empty('/api/twilio/outbound-status'))).status).toBe(400);
});

it('a form body without a Twilio signature is still rejected with 401', async () => {
  const req = new NextRequest('https://example.com/api/twilio/outbound-voice', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'CallSid=CA1&From=sip:mark@x&To=sip:+15555550100@x' });
  expect((await voice(req)).status).toBe(401);
});
