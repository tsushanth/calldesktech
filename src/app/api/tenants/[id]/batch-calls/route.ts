import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant, belongsToTenant } from '@/lib/authz';
import { validateCallTimeWindow } from '@/lib/batchCallSchedule';

interface Recipient {
  phone_number: string;
  dynamic_variables: Record<string, string> | null;
}

const PHONE_COLUMN_NAMES = new Set(['phone', 'phone_number', 'to', 'to_number', 'number']);

// Splits one CSV/text line on commas, respecting double-quoted fields (so a
// quoted value containing a comma, e.g. "Smith, Alex", stays one field).
// Retell's own batch-call CSV format is exactly this shape — plain comma-
// separated with optional quoting, no escaping beyond doubled quotes.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

// Turns a pasted/uploaded blob into recipients, each with an optional set of
// dynamic variables. Two shapes, auto-detected:
//
//  1. Plain list — one number per line (or comma/semicolon-separated), no
//     header. Today's only format; still fully supported, no variables.
//  2. CSV with a header row — a column named phone/phone_number/to/to_number/
//     number is the recipient, every OTHER column becomes a dynamic variable
//     for that row (e.g. a "first_name" column lets the flow say
//     {{first_name}}). Mirrors Retell's own Batch Call CSV upload.
//
// Deliberately does NOT validate E.164 shape — Retell/Twilio are the source
// of truth for what's dialable, and a bad number just fails that one target
// at trigger time rather than blocking the whole batch.
function parseRecipients(input: unknown): Recipient[] {
  const raw = Array.isArray(input) ? input.join('\n') : String(input ?? '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const headerFields = splitCsvLine(lines[0]).map((f) => f.toLowerCase());
  const phoneColIdx = headerFields.findIndex((f) => PHONE_COLUMN_NAMES.has(f));
  const isCsvWithHeader = phoneColIdx !== -1 && lines.length > 1;

  const seen = new Set<string>();
  const out: Recipient[] = [];

  if (isCsvWithHeader) {
    const originalHeaders = splitCsvLine(lines[0]);
    for (const line of lines.slice(1)) {
      const fields = splitCsvLine(line);
      const phone = (fields[phoneColIdx] || '').trim();
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      const vars: Record<string, string> = {};
      originalHeaders.forEach((h, i) => {
        if (i === phoneColIdx) return;
        const v = (fields[i] || '').trim();
        if (h.trim() && v) vars[h.trim()] = v;
      });
      out.push({ phone_number: phone, dynamic_variables: Object.keys(vars).length ? vars : null });
    }
    return out;
  }

  // Plain list: every non-empty token (newline/comma/semicolon separated) is
  // a bare number with no variables.
  for (const part of raw.split(/[\n,;]+/)) {
    const n = part.trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push({ phone_number: n, dynamic_variables: null });
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
  const recipients = parseRecipients(body.phoneNumbers ?? body.numbers);

  if (!agentVersionId) {
    return NextResponse.json({ error: 'agentVersionId is required' }, { status: 400 });
  }
  if (!(await belongsToTenant('calldesk_agent_versions', agentVersionId, tenantIdFromAuth(__auth)))) {
    return NextResponse.json({ error: 'agentVersionId not found' }, { status: 404 });
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'At least one phone number is required' }, { status: 400 });
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : null;

  let scheduledAt: string | null = null;
  if (body.scheduledAt != null) {
    const d = new Date(body.scheduledAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'scheduledAt must be a valid date/time' }, { status: 400 });
    }
    if (d.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'scheduledAt must be in the future' }, { status: 400 });
    }
    scheduledAt = d.toISOString();
  }

  let callTimeWindow;
  try {
    callTimeWindow = validateCallTimeWindow(body.callTimeWindow);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid callTimeWindow' }, { status: 400 });
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
    .insert({
      tenant_id: tenantId,
      agent_version_id: agentVersionId,
      status: 'pending',
      name,
      scheduled_at: scheduledAt,
      call_time_window: callTimeWindow,
    })
    .select()
    .single();
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });

  const { error: targetsError } = await supabase
    .from('calldesk_batch_call_targets')
    .insert(recipients.map((r) => ({ batch_id: batch.id, phone_number: r.phone_number, dynamic_variables: r.dynamic_variables })));
  if (targetsError) {
    // Roll the header back so we never leave a targetless batch behind.
    await supabase.from('calldesk_batch_calls').delete().eq('id', batch.id);
    return NextResponse.json({ error: targetsError.message }, { status: 500 });
  }

  return NextResponse.json(
    { batchCall: { ...batch, target_count: recipients.length, called_count: 0, failed_count: 0 } },
    { status: 201 }
  );
}
