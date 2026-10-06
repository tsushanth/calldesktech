import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { DEMO_CALL_IP, tryAcquireToken } from '@/lib/rateLimiter';
import { buildWizardFlow, DEFAULT_WIZARD_BLOCKS } from '@/lib/flowBuilder';
import { HEAR_CONSENT_TEXT, HEAR_CONSENT_VERSION, hearConsentSha256, hearLimitError, parseHearBody } from '@/lib/hear';

export const dynamic = 'force-dynamic';

// POST /api/hear { phone, consent, businessName?, website (honeypot), shownVersion, shownSha256 }
// Public. Places ONE demo call from our voice engine to the number the visitor typed, after they ticked the consent box.
// Off until HEAR_ENABLED=1 and HEAR_TENANT_ID (the workspace the demo calls run under) are set. The audit row is written BEFORE
// the call; if it cannot be written, no call is placed.
export async function POST(request: NextRequest) {
  if (process.env.HEAR_ENABLED !== '1' || !process.env.HEAR_TENANT_ID) {
    return NextResponse.json({ error: 'The demo call is not available right now.' }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const parsed = parseHearBody(body);
  if (!parsed.ok) {
    if (parsed.bot) return NextResponse.json({ ok: true }); // silent success for bots
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (!(await tryAcquireToken(`hear:ip:${ip}`, DEMO_CALL_IP))) {
    return NextResponse.json({ error: 'Too many requests. Please try again in a few minutes.' }, { status: 429 });
  }

  const db = getSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const count = async (col: 'phone' | 'ip' | null, val?: string) => {
    let q = db.from('calldesk_hear_requests').select('id', { count: 'exact', head: true }).gte('created_at', since).neq('status', 'failed');
    if (col && val) q = q.eq(col, val);
    const { count: n, error } = await q;
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  let limit;
  try {
    const [phoneToday, ipToday, globalToday, dnc] = await Promise.all([
      count('phone', parsed.phone), count('ip', ip), count(null),
      db.from('calldesk_do_not_call').select('phone').eq('phone', parsed.phone).maybeSingle(),
    ]);
    limit = hearLimitError({ phoneToday, ipToday, globalToday, onDoNotCall: !!dnc.data });
  } catch (e) {
    console.error('[hear] limit check failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 }); // fail closed: no call
  }
  if (limit) return NextResponse.json({ error: limit.error }, { status: limit.status });

  const { data: row, error: insErr } = await db.from('calldesk_hear_requests').insert({
    phone: parsed.phone, business_name: parsed.businessName,
    consent_version: HEAR_CONSENT_VERSION, consent_text: HEAR_CONSENT_TEXT, consent_sha256: hearConsentSha256(),
    page_url: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '')}/hear`,
    referrer: (request.headers.get('referer') || '').slice(0, 500) || null,
    accept_language: (request.headers.get('accept-language') || '').slice(0, 100) || null,
    ip, user_agent: (request.headers.get('user-agent') || '').slice(0, 300),
  }).select('id').single();
  if (insErr || !row) {
    console.error('[hear] could not write the audit record:', insErr?.message);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
  const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (!baseUrl || !secret) {
    await db.from('calldesk_hear_requests').update({ status: 'failed', error: 'calling not configured' }).eq('id', row.id);
    return NextResponse.json({ error: 'The demo call is not available right now.' }, { status: 503 });
  }

  const name = parsed.businessName || 'a local business';
  const flow = buildWizardFlow({
    businessName: name,
    greeting: `Hi, this is the Calldesk demo. You asked to hear what it sounds like when an AI answers the phone for ${name}. Ask me anything, or try booking an appointment.`,
  }, DEFAULT_WIZARD_BLOCKS);

  const res = await fetch(`${baseUrl}/place-test-call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ toNumber: parsed.phone, demoFlow: { ...flow, tenantId: process.env.HEAR_TENANT_ID } }),
  }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) {
    await db.from('calldesk_hear_requests').update({ status: 'failed', error: String(out?.error || out?.detail?.message || (res ? res.status : 'no response')).slice(0, 300) }).eq('id', row.id);
    return NextResponse.json({ error: 'We could not place the call. Please try again later.' }, { status: 502 });
  }
  await db.from('calldesk_hear_requests').update({ status: 'placed', call_sid: out.sid ?? null }).eq('id', row.id);
  return NextResponse.json({ ok: true }, { status: 201 });
}
