import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeResource } from '@/lib/authz';
import { carrierOfRow } from '@/lib/numberAddOn';
import { billedNumberCount, setNumberAddOnCount } from '@/lib/numberAddOnBilling';
import { releaseViaEngine } from '@/lib/numberRelease';

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
