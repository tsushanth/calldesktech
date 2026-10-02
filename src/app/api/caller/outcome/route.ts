import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authenticateLink } from '@/lib/callerAuth';
import { validateOutcomeInput } from '@/lib/callerPortal';

// POST /api/caller/outcome — record the outcome for one of the caller's own numbers. A caller can only change
// their own rows. "do_not_call" also blocks the number for everyone, immediately, on the sales line.
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400, headers });
  }
  const user = await authenticateLink(typeof body.k === 'string' ? body.k : null);
  if (!user) return NextResponse.json({ error: 'This link is not valid.' }, { status: 401, headers });
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'Missing row.' }, { status: 400, headers });

  const v = validateOutcomeInput(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers });

  const db = getSupabaseAdmin();
  const { data: row } = await db
    .from('calldesk_call_batches')
    .select('id, phone, sip_username')
    .eq('id', body.id)
    .maybeSingle();
  if (!row || row.sip_username !== user.sip_username) {
    return NextResponse.json({ error: 'That number is not in your batch.' }, { status: 404, headers });
  }

  const { data: updated, error } = await db
    .from('calldesk_call_batches')
    .update({
      outcome: v.value.outcome,
      notes: v.value.notes,
      mobile_number: v.value.mobile_number,
      text_ok: v.value.text_ok,
      outcome_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select('id, outcome, notes, mobile_number, text_ok')
    .single();
  if (error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500, headers });

  if (v.value.outcome === 'do_not_call') {
    await db
      .from('calldesk_do_not_call')
      .upsert({ phone: row.phone, reason: `logged by ${user.sip_username}` }, { onConflict: 'phone', ignoreDuplicates: true });
  }
  return NextResponse.json({ ok: true, row: updated }, { headers });
}
