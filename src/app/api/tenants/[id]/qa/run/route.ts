import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { runAndStoreCallQa } from '@/lib/callQa';

// POST /api/tenants/[id]/qa/run — backfill QA for a tenant's calls that have a
// transcript but haven't been scored yet (status pending or failed). This is a
// deliberate, user-initiated action (a button in the QA dashboard): each call
// scored costs an Anthropic request, so it is not run automatically and is
// capped per invocation. New calls are scored automatically by the webhook.
const BATCH_LIMIT = 25;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: calls, error } = await supabase
    .from('calldesk_call_logs')
    .select('retell_call_id, transcript')
    .eq('tenant_id', tenantId)
    .in('qa_status', ['pending', 'failed'])
    .not('transcript', 'is', null)
    .order('created_at', { ascending: false })
    .limit(BATCH_LIMIT);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!calls || calls.length === 0) {
    return NextResponse.json({ processed: 0, completed: 0, failed: 0, skipped: 0 });
  }

  // Fetch the agent's instructions once for the whole batch (all rows share the
  // tenant, so they share the agent's prompt).
  const agentInstructions = await getAgentInstructions(tenantId, supabase);

  const counts = { completed: 0, failed: 0, skipped: 0 };
  for (const call of calls) {
    const status = await runAndStoreCallQa({
      supabase,
      retellCallId: call.retell_call_id,
      transcript: call.transcript,
      agentInstructions,
    });
    counts[status] += 1;
  }

  return NextResponse.json({ processed: calls.length, ...counts });
}

async function getAgentInstructions(
  tenantId: string,
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<string | null> {
  try {
    const { data: tenant } = await supabase
      .from('calldesk_tenants')
      .select('retell_llm_id')
      .eq('id', tenantId)
      .single();
    if (!tenant?.retell_llm_id) return null;
    const llm = await getRetellClient().getLLM(tenant.retell_llm_id);
    return llm.general_prompt?.trim() || null;
  } catch (error) {
    console.error('Could not fetch agent instructions for QA backfill:', error);
    return null;
  }
}
