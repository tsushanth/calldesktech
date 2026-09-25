import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Resend (Svix-signed) delivery webhook. Records delivered/bounced/complained/delayed/opened/clicked per outreach
// message (opens and clicks are noisy: mail-client prefetch and link scanners inflate them) and
// suppresses the address on a hard bounce or a spam complaint so we never mail it again.
// Set RESEND_WEBHOOK_SECRET to the "whsec_..." signing secret shown for the webhook in the Resend dashboard.

const TOLERANCE_SECONDS = 5 * 60;
const RECORDED = new Set(['email.delivered', 'email.bounced', 'email.complained', 'email.delivery_delayed', 'email.opened', 'email.clicked']);

function verifySvix(secret: string, id: string, timestamp: string, body: string, signatureHeader: string): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signatureHeader.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Resend's delivery_delayed payload carries the reason; keep only non-content fields so the row stays small.
function delayDetail(data: unknown): unknown {
  if (!data || typeof data !== 'object') return null;
  const rest = { ...(data as Record<string, unknown>) };
  for (const k of ['html', 'text', 'subject', 'to']) delete rest[k];
  return Object.keys(rest).length ? rest : null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET || '';
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const body = await request.text();
  const id = request.headers.get('svix-id') || '';
  const ts = request.headers.get('svix-timestamp') || '';
  const sig = request.headers.get('svix-signature') || '';
  if (!id || !ts || !sig || !verifySvix(secret, id, ts, body, sig)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let evt: { type?: string; data?: { email_id?: string; bounce?: { type?: string; subType?: string; message?: string } } };
  try {
    evt = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const type = evt.type || '';
  const resendId = evt.data?.email_id || '';
  if (!RECORDED.has(type) || !resendId) return NextResponse.json({ ok: true, ignored: true });

  const supabase = getSupabaseAdmin();
  const { data: msg } = await supabase.from('calldesk_outreach_messages').select('id,to_email').eq('resend_id', resendId).maybeSingle();
  const event = type.replace('email.', '');

  const { error } = await supabase.from('calldesk_outreach_email_events').insert({
    svix_id: id,
    resend_id: resendId,
    message_id: msg?.id ?? null,
    event,
    detail: evt.data?.bounce ?? (evt.data as { click?: unknown } | undefined)?.click ?? delayDetail(evt.data),
  });
  if (error && error.code !== '23505') {
    console.error('[webhooks/resend] insert failed:', error.message);
    return NextResponse.json({ error: 'store failed' }, { status: 500 }); // Resend retries
  }

  const hardBounce = event === 'bounced' && String(evt.data?.bounce?.type || '').toLowerCase() === 'permanent';
  if (msg && (hardBounce || event === 'complained')) {
    await supabase.from('calldesk_outreach_suppressions').upsert(
      { email: String(msg.to_email).trim().toLowerCase(), reason: hardBounce ? 'hard bounce (resend)' : 'spam complaint (resend)' },
      { onConflict: 'email' },
    );
  }
  return NextResponse.json({ ok: true });
}
