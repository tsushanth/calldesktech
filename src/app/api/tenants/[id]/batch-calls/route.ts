import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant, belongsToTenant } from '@/lib/authz';

// Split a pasted/uploaded blob of numbers into a clean list. Accepts numbers
// separated by newlines, commas, or semicolons (however a spreadsheet paste
// or CSV column lands), trims each, drops blanks, and de-dupes while keeping
// first-seen order. Deliberately does NOT validate E.164 shape here — Retell
// is the source of truth for what's dialable, and a bad number just fails that
// one target at trigger time rather than blocking the whole batch.
function parseNumbers(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.join('\n') : String(input ?? '');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const n = part.trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

// GET /api/tenants/[id]/batch-calls — list a tenant's batches, newest first,
// each with a rollup of how many targets it has / were placed / failed so the
// dashboard table can show progress without a second round-trip per batch.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: batches, error } = await supabase
    .from('calldesk_batch_calls')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const batchIds = (batches || []).map((b) => b.id);
  const { data: targets } = batchIds.length
    ? await supabase
        .from('calldesk_batch_call_targets')
        .select('batch_id, status')
        .in('batch_id', batchIds)
    : { data: [] as { batch_id: string; status: string }[] };

  const withCounts = (batches || []).map((b) => {
    const ts = (targets || []).filter((t) => t.batch_id === b.id);
    return {
      ...b,
      target_count: ts.length,
      called_count: ts.filter((t) => t.status === 'calling').length,
      failed_count: ts.filter((t) => t.status === 'failed').length,
    };
  });

  return NextResponse.json({ batchCalls: withCounts });
}

// POST /api/tenants/[id]/batch-calls — create a batch (status 'pending') plus
// one target row per parsed number. Does NOT place any calls; triggering is a
// separate step (POST /api/batch-calls/[id]/run) so creating a batch is cheap
// and can't be half-run if the request drops mid-dial.
function tenantIdFromAuth(a: { ok: true; tenantId?: string }): string {
  return a.tenantId as string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const body = await request.json();
  const { agentVersionId } = body;
  const numbers = parseNumbers(body.phoneNumbers ?? body.numbers);

  if (!agentVersionId) {
    return NextResponse.json({ error: 'agentVersionId is required' }, { status: 400 });
  }
  if (!(await belongsToTenant('calldesk_agent_versions', agentVersionId, tenantIdFromAuth(__auth)))) {
    return NextResponse.json({ error: 'agentVersionId not found' }, { status: 404 });
  }
  if (numbers.length === 0) {
    return NextResponse.json({ error: 'At least one phone number is required' }, { status: 400 });
  }

  // Confirm the picked version belongs to this tenant before we dial anything
  // with it — the version → agent → tenant chain is the ownership boundary.
  const { data: version } = await supabase
    .from('calldesk_agent_versions')
    .select('id, agent_id, calldesk_agents!inner(tenant_id)')
    .eq('id', agentVersionId)
    .single();
  const versionTenantId = (version as { calldesk_agents?: { tenant_id?: string } } | null)
    ?.calldesk_agents?.tenant_id;
  if (!version || versionTenantId !== tenantId) {
    return NextResponse.json({ error: 'Agent version not found for this tenant' }, { status: 404 });
  }

  const { data: batch, error: batchError } = await supabase
    .from('calldesk_batch_calls')
    .insert({ tenant_id: tenantId, agent_version_id: agentVersionId, status: 'pending' })
    .select()
    .single();
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });

  const { error: targetsError } = await supabase
    .from('calldesk_batch_call_targets')
    .insert(numbers.map((phone_number) => ({ batch_id: batch.id, phone_number })));
  if (targetsError) {
    // Roll the header back so we never leave a targetless batch behind.
    await supabase.from('calldesk_batch_calls').delete().eq('id', batch.id);
    return NextResponse.json({ error: targetsError.message }, { status: 500 });
  }

  return NextResponse.json(
    { batchCall: { ...batch, target_count: numbers.length, called_count: 0, failed_count: 0 } },
    { status: 201 }
  );
}
