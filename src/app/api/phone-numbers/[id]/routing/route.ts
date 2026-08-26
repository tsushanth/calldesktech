import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/phone-numbers/[id]/routing — points a phone number's inbound or
// outbound slot at a specific agent version. This IS "activation" in this
// model (mirrors Retell's own per-number Inbound/Outbound Call Agent
// dropdowns) — rolling back is just calling this again with an older
// version's id. Pass agentVersionId: null to disable a direction (e.g. turn
// outbound off). For a retell-engine version's inbound slot, also pushes
// the flow to Retell as a flattened prompt — no-op for poc engine.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: phoneNumberId } = await params;
  const supabase = getSupabaseAdmin();
  const { direction, agentVersionId } = await request.json();

  if (direction !== 'inbound' && direction !== 'outbound') {
    return NextResponse.json({ error: 'direction must be "inbound" or "outbound"' }, { status: 400 });
  }

  const column = direction === 'inbound' ? 'inbound_agent_version_id' : 'outbound_agent_version_id';
  const { data: phoneNumber, error } = await supabase
    .from('calldesk_phone_numbers')
    .update({ [column]: agentVersionId })
    .eq('id', phoneNumberId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (direction !== 'inbound' || !agentVersionId) {
    return NextResponse.json({ phoneNumber, syncedToRetell: false });
  }

  const { data: version } = await supabase
    .from('calldesk_agent_versions')
    .select('voice_engine')
    .eq('id', agentVersionId)
    .single();
  if (version?.voice_engine !== 'retell') {
    return NextResponse.json({ phoneNumber, syncedToRetell: false });
  }

  try {
    const res = await fetch(`${request.nextUrl.origin}/api/agent-versions/${agentVersionId}/sync-retell`, {
      method: 'POST',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: body.error || `sync route returned HTTP ${res.status}` }, { status: 500 });
    }
    return NextResponse.json({ phoneNumber, syncedToRetell: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync to Retell';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
