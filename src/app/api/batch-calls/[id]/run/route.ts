import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';

// POST /api/batch-calls/[id]/run — actually places the batch. Walks the
// batch's pending targets IN ORDER and dials each one through the same Retell
// outbound path a single call uses (getRetellClient().createPhoneCall, the
// wrapper over /v2/create-phone-call that /api/demo-call hits directly). A
// number that can't be placed is marked 'failed' and the batch moves on — one
// bad row never sinks the rest. Each placed call gets a calldesk_call_logs row
// (so it shows up in Calls and the Retell webhook can later fill in its
// outcome/transcript), and the target is linked to that log.
//
// Retell-engine only: placing a real PSTN call needs a retell_agent_id and a
// from-number, neither of which a poc-engine version has — so a poc version is
// rejected up front rather than dialing nothing.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params;
  const supabase = getSupabaseAdmin();

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
  if (version.voice_engine !== 'retell') {
    return failBatch('Batch calling is only supported for the Retell voice engine');
  }
  if (!version.retell_agent_id) {
    return failBatch('This agent version has no linked Retell agent to place calls with');
  }

  // From-number: prefer a phone number the tenant has explicitly routed to
  // this version's outbound slot (the Phone Numbers screen), so a batch dials
  // from the number that "belongs" to this agent; fall back to the shared demo
  // number the rest of the app uses for outbound.
  const { data: outboundNumber } = await supabase
    .from('calldesk_phone_numbers')
    .select('number')
    .eq('tenant_id', batch.tenant_id)
    .eq('outbound_agent_version_id', version.id)
    .limit(1)
    .maybeSingle();
  const fromNumber = outboundNumber?.number || process.env.RETELL_DEMO_PHONE_NUMBER;
  if (!fromNumber) {
    return failBatch(
      'No from-number available: route a phone number to this version for outbound, or set RETELL_DEMO_PHONE_NUMBER',
      500
    );
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

  const retell = getRetellClient();
  let placed = 0;
  let failed = 0;

  // Sequential by design — Retell rate-limits outbound and the product spec is
  // "places outbound calls to each one sequentially." No Promise.all here.
  for (const target of targets || []) {
    try {
      const { call_id } = await retell.createPhoneCall({
        fromNumber,
        toNumber: target.phone_number,
        agentId: version.retell_agent_id,
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

      await supabase
        .from('calldesk_batch_call_targets')
        .update({ status: 'calling', call_log_id: log?.id ?? null })
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
