import { NextRequest, NextResponse } from 'next/server';
import { authorizeResource } from '@/lib/authz';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { acquireTokenBlocking, RETELL_GLOBAL, RETELL_TENANT, TWILIO_TENANT } from '@/lib/rateLimiter';

// POST /api/batch-calls/[id]/run — actually places the batch. Walks the
// batch's pending targets IN ORDER and dials each one. A number that can't be
// placed is marked 'failed' and the batch moves on — one bad row never sinks
// the rest.
//
// Branches by voice_engine, same dispatch the Numbers page's single "Make an
// outbound call" button already uses (see /api/phone-numbers/[id]/call):
// retell-engine calls Retell's own outbound API directly; poc-engine proxies
// to call-loop-poc's /place-test-call, since that's the only thing that owns
// the Twilio credentials for a number bought on our own account.
//
// Real gap fixed here (2026-09-17): this used to hard-reject any non-retell
// version ("Batch calling is only supported for the Retell voice engine"),
// which after this session's pivot to poc-engine as the default meant batch
// calling didn't work AT ALL for the actual product — only for the Retell
// comparison baseline. The UI's version picker never warned about this
// either, so creating a batch against a poc-engine agent silently succeeded
// and only failed confusingly at Run time.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params;
  const supabase = getSupabaseAdmin();

  // This route places real, billable outbound phone calls — it must not be
  // reachable by anyone who merely knows (or guesses) a batch id. Was
  // previously wide open: no session check at all, matching a pattern
  // several other routes on this surface still have, but the cost/risk here
  // (real PSTN calls, not just a data read) made it the one worth fixing.
  const __auth = await authorizeResource(request, 'calldesk_batch_calls', batchId);
  if (!__auth.ok) return __auth.response;

  const { data: batch, error: batchError } = await supabase
    .from('calldesk_batch_calls')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchError || !batch) {
    return NextResponse.json({ error: 'Batch call not found' }, { status: 404 });
  }

  // Only a fresh batch is runnable — guards against a double-trigger dialing
  // everyone twice if the button is hit again while a run is in flight.
  if (batch.status !== 'pending') {
    return NextResponse.json(
      { error: `Batch is '${batch.status}', not 'pending' — nothing to run` },
      { status: 409 }
    );
  }

  const failBatch = async (message: string, code = 400) => {
    await supabase.from('calldesk_batch_calls').update({ status: 'failed' }).eq('id', batchId);
    return NextResponse.json({ error: message }, { status: code });
  };

  if (!batch.agent_version_id) {
    return failBatch('This batch has no agent version (it may have been deleted)');
  }

  const { data: version } = await supabase
    .from('calldesk_agent_versions')
    .select('id, voice_engine, retell_agent_id')
    .eq('id', batch.agent_version_id)
    .single();
  if (!version) {
    return failBatch('Agent version not found');
  }
  const isPoc = version.voice_engine === 'poc';
  if (!isPoc && version.voice_engine !== 'retell') {
    return failBatch(`Unknown voice engine "${version.voice_engine}"`);
  }
  if (!isPoc && !version.retell_agent_id) {
    return failBatch('This agent version has no linked Retell agent to place calls with');
  }

  // From-number: prefer a phone number the tenant has explicitly routed to
  // this version's outbound slot (the Phone Numbers screen), so a batch dials
  // from the number that "belongs" to this agent. Retell falls back to the
  // shared demo number the rest of the app uses for outbound; a poc-engine
  // number has no such fallback — it's a real Twilio number on our own
  // account, so there's no "shared demo" equivalent to fall back to.
  const { data: outboundNumber } = await supabase
    .from('calldesk_phone_numbers')
    .select('number')
    .eq('tenant_id', batch.tenant_id)
    .eq('outbound_agent_version_id', version.id)
    .limit(1)
    .maybeSingle();
  const fromNumber = outboundNumber?.number || (isPoc ? undefined : process.env.RETELL_DEMO_PHONE_NUMBER);
  if (!fromNumber) {
    return failBatch(
      isPoc
        ? 'No from-number available: route a phone number to this version\'s outbound slot on the Phone Numbers page first'
        : 'No from-number available: route a phone number to this version for outbound, or set RETELL_DEMO_PHONE_NUMBER',
      500
    );
  }

  const callLoopBaseUrl = process.env.CALL_LOOP_POC_BASE_URL;
  const callLoopSecret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (isPoc && (!callLoopBaseUrl || !callLoopSecret)) {
    return failBatch('CALL_LOOP_POC_BASE_URL/CALL_LOOP_POC_TEST_CALL_SECRET not configured', 500);
  }

  const { data: targets, error: targetsError } = await supabase
    .from('calldesk_batch_call_targets')
    .select('*')
    .eq('batch_id', batchId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (targetsError) {
    return failBatch(targetsError.message, 500);
  }

  await supabase.from('calldesk_batch_calls').update({ status: 'running' }).eq('id', batchId);

  const retell = isPoc ? null : getRetellClient();
  let placed = 0;
  let failed = 0;

  // Sequential by design — both Retell and Twilio rate-limit outbound calls,
  // and the product spec is "places outbound calls to each one sequentially."
  // No Promise.all here.
  for (const target of targets || []) {
    try {
      // Per-tenant pacing regardless of engine — see rateLimiter.ts and
      // migration 023 for why this AND a global cap are both needed (Twilio/
      // Retell are each one account shared across every tenant, so a
      // per-tenant limiter alone can't stop two tenants' batches together
      // exceeding the real account-level limit; the global cap for that is
      // enforced at the actual dial choke point — inside call-loop-poc for
      // Twilio, right below for Retell).
      const tenantKey = `${isPoc ? 'twilio' : 'retell'}-tenant-${batch.tenant_id}`;
      const tenantConfig = isPoc ? TWILIO_TENANT : RETELL_TENANT;
      const gotTenantToken = await acquireTokenBlocking(tenantKey, tenantConfig);
      if (!gotTenantToken) throw new Error('Rate limit wait timed out for this tenant');

      let callLogId: string | null = null;

      if (isPoc) {
        // call-loop-poc's own 'start' handler inserts the calldesk_call_logs
        // row itself once the call actually connects (same path the Numbers
        // page's single outbound call uses) — nothing to insert here, and
        // call_log_id stays null on the target row since that id doesn't
        // exist yet at REST-call time. It's still fully visible on the Calls
        // page under this tenant, just not deep-linked from this row.
        const res = await fetch(`${callLoopBaseUrl}/place-test-call`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${callLoopSecret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ toNumber: target.phone_number, routeAs: fromNumber, direction: 'outbound' }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'call-loop-poc rejected the call');
      } else {
        const gotGlobalToken = await acquireTokenBlocking('retell-global', RETELL_GLOBAL);
        if (!gotGlobalToken) throw new Error('Rate limit wait timed out (platform-wide Retell cap)');
        const { call_id } = await retell!.createPhoneCall({
          fromNumber,
          toNumber: target.phone_number,
          agentId: version.retell_agent_id!,
        });
        const { data: log } = await supabase
          .from('calldesk_call_logs')
          .insert({
            tenant_id: batch.tenant_id,
            retell_call_id: call_id,
            caller_phone: target.phone_number,
            outcome: 'answered', // placeholder; the Retell webhook fills the real outcome
            duration_seconds: 0,
          })
          .select('id')
          .single();
        callLogId = log?.id ?? null;
      }

      await supabase
        .from('calldesk_batch_call_targets')
        .update({ status: 'calling', call_log_id: callLogId })
        .eq('id', target.id);
      placed++;
    } catch (err) {
      console.error(`Batch ${batchId}: failed to place call to ${target.phone_number}:`, err);
      await supabase
        .from('calldesk_batch_call_targets')
        .update({ status: 'failed' })
        .eq('id', target.id);
      failed++;
    }
  }

  await supabase.from('calldesk_batch_calls').update({ status: 'completed' }).eq('id', batchId);

  return NextResponse.json({ batchId, placed, failed, total: (targets || []).length });
}
