import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';
import { carrierOfRow } from '@/lib/numberAddOn';
import { billedNumberCount, setNumberAddOnCount } from '@/lib/numberAddOnBilling';

// TODO(engine): call-loop-poc has no number-release endpoint yet (only POST /purchase-number). Needed there, same admin-secret guard as
// /purchase-number (Authorization: Bearer CALL_LOOP_POC_TEST_CALL_SECRET):
//   POST /release-number  { "number": "+14155550123", "carrier": "twilio" | "telnyx" }
//   -> looks the number up on that carrier's account (exact E.164 match) and releases it.
//   -> 200 on success (also when already released: idempotent); 404 { "error" } when not found; 4xx/5xx { "error": string } otherwise.
// The engine endpoint exists on branch telnyx-numbers of realtime-tts. Until it is deployed the web app answers 501 for purchased numbers
// and changes nothing: the number is still held on the carrier, so billing must not stop either.
async function releaseViaEngine(phoneNumber: string, carrier: string): Promise<{ ok: true } | { ok: false; status: number; error: string; unsupported?: boolean }> {
  const baseUrl = process.env.CALL_LOOP_POC_BASE_URL;
  const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (!baseUrl || !secret) return { ok: false, status: 500, error: 'CALL_LOOP_POC_BASE_URL/CALL_LOOP_POC_TEST_CALL_SECRET not configured' };
  try {
    const res = await fetch(`${baseUrl}/release-number`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phoneNumber, carrier }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    // An engine without the endpoint answers 404 with no JSON error body (the app's own 404 for an unknown route).
    if (res.status === 404 && !body?.error) return { ok: false, status: 501, error: 'Releasing purchased numbers is not available yet.', unsupported: true };
    return { ok: false, status: res.status >= 400 ? res.status : 502, error: body?.error || 'The voice engine could not release the number' };
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : 'Failed to reach the voice engine' };
  }
}

// DELETE /api/phone-numbers/[id] — remove a number from the workspace. A ported (bring-your-own) number is only unregistered. A purchased
// number is first released on its carrier through the engine, then removed, and if it was billed under the premium number add-on the
// Stripe monthly quantity drops by one (items are removed when no numbers remain).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const __auth = await authorizeResource(request, 'calldesk_phone_numbers', id);
  if (!__auth.ok) return __auth.response;

  const supabase = getSupabaseAdmin();
  const { data: row, error } = await supabase
    .from('calldesk_phone_numbers')
    .select('id, tenant_id, number, source, carrier, addon_billed')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Phone number not found' }, { status: 404 });

  if (row.source === 'purchased') {
    const released = await releaseViaEngine(row.number, carrierOfRow(row.carrier) ?? 'twilio');
    if (!released.ok) {
      return NextResponse.json({ error: released.error, code: released.unsupported ? 'number_release_unavailable' : 'number_release_failed' }, { status: released.status });
    }
  }

  const { error: deleteError } = await supabase.from('calldesk_phone_numbers').delete().eq('id', id);
  if (deleteError) {
    // Released on the carrier but the row stayed: say so, retrying the delete is safe (the engine release is idempotent).
    return NextResponse.json({ error: `Released on the carrier but failed to remove: ${deleteError.message}`, retryable: true }, { status: 500 });
  }

  let warning: string | undefined;
  const carrier = carrierOfRow(row.carrier);
  if (row.addon_billed === true && carrier) {
    try {
      const remaining = await billedNumberCount(supabase, row.tenant_id, carrier);
      await setNumberAddOnCount(supabase, row.tenant_id, carrier, remaining); // 'no_subscription' means nothing to adjust
    } catch (err) {
      console.error('Number released but Stripe add-on billing could not be reduced; reconcile by hand', { tenantId: row.tenant_id, number: row.number }, err);
      warning = 'The number was released but its monthly charge could not be updated automatically. Support has been notified.';
    }
  }

  return NextResponse.json({ deleted: true, ...(warning ? { warning } : {}) });
}
