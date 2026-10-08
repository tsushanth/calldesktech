import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { confirmableLeads, confirmedOutreach } from '@/lib/outreach/formConfirmation';

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

  // Exact, case-insensitive match through an indexed function (migration 060). The previous
  // .ilike() scanned all ~416k leads on every inbound email (4s idle, timed out under load) and
  // treated _ and % in the address as wildcards, so it could mark the wrong lead as replied.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('calldesk_mark_replied', { p_email: email });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A contact form that showed no proof on the page is confirmed by the company's own auto-reply email (best effort: never fails the webhook).
  const confirmed: string[] = [];
  try {
    const mail = {
      from: email,
      fromHeader: typeof body?.fromHeader === 'string' ? body.fromHeader : null,
      subject: typeof body?.subject === 'string' ? body.subject : null,
      receivedAt: new Date(),
    };
    const { data: pending } = await supabase
      .from('calldesk_outreach_leads')
      .select('id, domain, signals')
      .eq('product', 'calldesk')
      .eq('signals->formOutreach->>status', 'needs_manual')
      .limit(500);
    for (const lead of confirmableLeads(pending ?? [], mail)) {
      const signals = { ...lead.signals, formOutreach: confirmedOutreach(lead.signals.formOutreach, mail) };
      const { error: upErr } = await supabase
        .from('calldesk_outreach_leads')
        .update({ signals })
        .eq('id', lead.id)
        .eq('signals->formOutreach->>status', 'needs_manual');
      if (!upErr && lead.domain) confirmed.push(lead.domain);
    }
  } catch {
    /* confirmation is an extra; the reply marking above already succeeded */
  }

  return NextResponse.json({ matched: data ?? 0, confirmed });
}
