import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import type { RetellWebhookEvent } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const event = (await request.json()) as RetellWebhookEvent;
    const supabase = getSupabaseAdmin();

    // Find tenant by agent ID
    const { data: tenant } = await supabase
      .from('calldesk_tenants')
      .select('id, user_id, retell_agent_id, retell_llm_id, knowledge_base_id')
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

      case 'call_ended': {
        // Update call log with duration
        const duration = event.call.end_timestamp && event.call.start_timestamp
          ? Math.floor((event.call.end_timestamp - event.call.start_timestamp) / 1000)
          : 0;

        // Finalize the call's outcome. call_started seeds it as 'answered';
        // a transfer hand-off (Retell's disconnection_reason) is the one
        // terminal state we can distinguish here, and it drives both the
        // stored outcome and which outbound webhook event fires below.
        const reason = event.call.disconnection_reason ?? '';
        const transferred = /transfer/i.test(reason);
        const outcome = transferred ? 'transferred' : 'answered';

        await supabase
          .from('calldesk_call_logs')
          .update({
            duration_seconds: duration,
            outcome,
            transcript: event.call.transcript ? [{ role: 'system', content: event.call.transcript }] : null,
          })
          .eq('retell_call_id', event.call.call_id);

        // Notify the tenant's registered outbound webhooks. Best-effort:
        // dispatchWebhookEvent never throws, so a slow/failing customer
        // endpoint can't fail our response back to Retell.
        const webhookData = {
          call_id: event.call.call_id,
          tenant_id: tenant.id,
          caller_phone: event.call.from_number,
          to_number: event.call.to_number,
          direction: event.call.direction,
          duration_seconds: duration,
          outcome,
          disconnection_reason: reason || null,
          transcript: event.call.transcript ?? null,
          recording_url: event.call.recording_url ?? null,
          started_at: event.call.start_timestamp
            ? new Date(event.call.start_timestamp).toISOString()
            : null,
          ended_at: event.call.end_timestamp
            ? new Date(event.call.end_timestamp).toISOString()
            : null,
        };
        await dispatchWebhookEvent(tenant.id, 'call.completed', webhookData);
        if (transferred) {
          await dispatchWebhookEvent(tenant.id, 'call.transferred', webhookData);
        }
        break;
      }

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
