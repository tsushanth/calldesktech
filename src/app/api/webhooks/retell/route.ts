import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { runAndStoreCallQa } from '@/lib/callQa';
import { deriveOutcome, fireAlertsForCall } from '@/lib/alerts';
import type { RetellWebhookEvent } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const event = (await request.json()) as RetellWebhookEvent;
    const supabase = getSupabaseAdmin();

    // Find tenant by agent ID
    const { data: tenant } = await supabase
      .from('calldesk_tenants')
      .select('id, name, user_id, retell_agent_id, retell_llm_id, knowledge_base_id')
      .eq('retell_agent_id', event.call.agent_id)
      .single();

    if (!tenant) {
      console.error('No tenant found for agent:', event.call.agent_id);
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    switch (event.event) {
      case 'call_started':
        // Log call start
        await supabase.from('calldesk_call_logs').insert({
          tenant_id: tenant.id,
          retell_call_id: event.call.call_id,
          caller_phone: event.call.from_number,
          outcome: 'answered', // Will be updated on call_ended
          duration_seconds: 0,
        });
        break;

      case 'call_ended':
        // Update call log with duration
        const duration = event.call.end_timestamp && event.call.start_timestamp
          ? Math.floor((event.call.end_timestamp - event.call.start_timestamp) / 1000)
          : 0;

        // Finalize the call's outcome from how Retell says it ended. On
        // call_started we optimistically stamp 'answered'; here is where a
        // transfer/voicemail/no-answer becomes known. deriveOutcome returns
        // null for a normal completed call — leave the existing outcome as-is
        // in that case so we never clobber a 'booked'/'answered' with nothing.
        const finalizedOutcome = deriveOutcome(event.call);

        await supabase
          .from('calldesk_call_logs')
          .update({
            duration_seconds: duration,
            transcript: event.call.transcript ? [{ role: 'system', content: event.call.transcript }] : null,
            ...(finalizedOutcome ? { outcome: finalizedOutcome } : {}),
          })
          .eq('retell_call_id', event.call.call_id);

        // AI Quality Assurance: score the just-saved transcript with Claude and
        // store sentiment/quality/critique on the same row. Run inline (not
        // fire-and-forget) so it actually executes in a serverless runtime;
        // runAndStoreCallQa never throws, so it can't break the webhook. Skip
        // entirely when there's no transcript to score.
        if (event.call.transcript) {
          await runAndStoreCallQa({
            supabase,
            retellCallId: event.call.call_id,
            transcript: event.call.transcript,
            agentInstructions: await getAgentInstructions(tenant.retell_llm_id),
          });
        }

        // Fire any alert rules the tenant configured for this outcome. Skipped
        // for demo tenants — those are throwaway and get cleaned up below. This
        // is best-effort (never throws) so a mail hiccup can't fail the webhook.
        if (finalizedOutcome && !tenant.user_id?.startsWith('demo_')) {
          await fireAlertsForCall({
            tenantId: tenant.id,
            outcome: finalizedOutcome,
            call: event.call,
            businessName: tenant.name,
          });
        }
        break;

      case 'call_analyzed':
        // Update with analysis results and extracted data
        // This is where booking data would be extracted

        // Clean up demo tenants after call is complete
        if (tenant.user_id?.startsWith('demo_')) {
          console.log(`Cleaning up demo tenant: ${tenant.id}`);
          await cleanupDemoTenant(tenant);
        }
        break;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Retell webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Best-effort fetch of the agent's own instructions (the Retell LLM's
// general_prompt) so QA can judge whether the agent followed them. Returns null
// on any failure — QA still runs, just against general best practices.
async function getAgentInstructions(retellLlmId: string | null): Promise<string | null> {
  if (!retellLlmId) return null;
  try {
    const llm = await getRetellClient().getLLM(retellLlmId);
    return llm.general_prompt?.trim() || null;
  } catch (error) {
    console.error('Could not fetch agent instructions for QA:', error);
    return null;
  }
}

// Clean up demo tenant resources from Retell and database
async function cleanupDemoTenant(tenant: {
  id: string;
  user_id: string;
  retell_agent_id: string | null;
  retell_llm_id: string | null;
  knowledge_base_id: string | null;
}) {
  const retell = getRetellClient();
  const supabase = getSupabaseAdmin();

  try {
    // Delete Retell resources in order: agent -> LLM -> KB
    if (tenant.retell_agent_id) {
      await retell.deleteAgent(tenant.retell_agent_id);
      console.log(`Deleted Retell agent: ${tenant.retell_agent_id}`);
    }

    if (tenant.retell_llm_id) {
      await retell.deleteLLM(tenant.retell_llm_id);
      console.log(`Deleted Retell LLM: ${tenant.retell_llm_id}`);
    }

    if (tenant.knowledge_base_id) {
      await retell.deleteKnowledgeBase(tenant.knowledge_base_id);
      console.log(`Deleted Retell KB: ${tenant.knowledge_base_id}`);
    }

    // Delete tenant from database (cascades to call_logs, bookings, etc.)
    await supabase.from('calldesk_tenants').delete().eq('id', tenant.id);
    console.log(`Deleted demo tenant from database: ${tenant.id}`);
  } catch (error) {
    console.error('Error cleaning up demo tenant:', error);
    // Don't throw - we don't want to fail the webhook response
  }
}
