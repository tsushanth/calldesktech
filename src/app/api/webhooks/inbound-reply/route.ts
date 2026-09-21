import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Called by the Cloudflare Email Worker (see cloudflare-email-workers/inbound-reply-webhook.js)
// the instant a reply lands on any outreach sending domain, BEFORE it forwards
// the message on to Gmail. Marks every matching lead (any product) as replied,
// which stops the follow-up sequence for that lead — this is the automated
// alternative to the queue's manual "Mark as replied" button, not a
// replacement for it (both write the same column).

function validSecret(given: string | null): boolean {
  const expected = process.env.WEBHOOK_INBOUND_REPLY_SECRET || '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const given = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!validSecret(given)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_outreach_leads')
    .update({ replied_at: new Date().toISOString() })
    .ilike('contact_email', email)
    .is('replied_at', null)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ matched: data?.length ?? 0 });
}
