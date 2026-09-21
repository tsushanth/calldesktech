import { NextRequest, NextResponse } from 'next/server';
import { authorizeResource } from '@/lib/authz';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/batch-calls/[id] — one batch plus every target row (phone number,
// status, its dynamic variables, and the call log it produced when known),
// for the dashboard's per-call drill-down.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params;
  const __auth = await authorizeResource(request, 'calldesk_batch_calls', batchId);
  if (!__auth.ok) return __auth.response;

  const supabase = getSupabaseAdmin();
  const { data: batch, error } = await supabase.from('calldesk_batch_calls').select('*').eq('id', batchId).single();
  if (error || !batch) return NextResponse.json({ error: 'Batch call not found' }, { status: 404 });

  const { data: targets } = await supabase
    .from('calldesk_batch_call_targets')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  return NextResponse.json({ batchCall: batch, targets: targets || [] });
}
