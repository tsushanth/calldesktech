import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyUnsubscribeToken } from '@/lib/outreach/unsubscribe';

// POST only. Mail clients (RFC 8058 one-click) and the confirm button on
// /unsubscribe/[token] call this. GET never unsubscribes, so link scanners that
// prefetch URLs in emails can't suppress a real recipient.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let email: string | null = null;
  try {
    email = verifyUnsubscribeToken(decodeURIComponent(token));
  } catch {
    email = null;
  }
  if (!email) return NextResponse.json({ error: 'invalid link' }, { status: 400 });

  const { error } = await getSupabaseAdmin()
    .from('calldesk_outreach_suppressions')
    .upsert({ email, reason: 'unsubscribed via link' }, { onConflict: 'email' });
  if (error) return NextResponse.json({ error: 'store failed' }, { status: 500 });

  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) {
    return NextResponse.redirect(new URL(`/unsubscribe/${token}?done=1`, request.url), 303);
  }
  return NextResponse.json({ ok: true });
}
