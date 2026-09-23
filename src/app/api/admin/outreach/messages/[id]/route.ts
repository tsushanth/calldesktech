import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { sendApprovedMessage } from '@/lib/outreach/sender';

// PATCH { action: 'approve' | 'reject' | 'edit', subject?, body_text? }
// Only draft messages can change. Approving does not send; sending is its own
// explicit step (POST) so a mistaken click never emails a prospect.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const supabase = getSupabaseAdmin();

  const { data: msg } = await supabase.from('calldesk_outreach_messages').select('id,status,lead_id').eq('id', id).maybeSingle();
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  // Marks the LEAD as replied (there is no automated reply detection — this
  // is how a human reviewing the queue stops any further follow-up once they
  // see a real reply in their inbox). Any message status can trigger it.
  if (body.action === 'mark_replied') {
    const { error } = await supabase.from('calldesk_outreach_leads').update({ replied_at: new Date().toISOString() }).eq('id', msg.lead_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  let update: Record<string, unknown>;
  if (body.action === 'reject') {
    update = { status: 'rejected' };
  } else if (body.action === 'approve') {
    if (msg.status !== 'draft') return NextResponse.json({ error: `Only drafts can be approved (this is "${msg.status}")` }, { status: 400 });
    update = { status: 'approved', approved_at: new Date().toISOString() };
  } else if (body.action === 'edit') {
    if (msg.status !== 'draft') return NextResponse.json({ error: 'Only drafts can be edited' }, { status: 400 });
    if (typeof body.subject !== 'string' || typeof body.body_text !== 'string' || !body.subject.trim() || !body.body_text.trim()) {
      return NextResponse.json({ error: 'subject and body_text are required' }, { status: 400 });
    }
    update = { subject: body.subject.trim(), body_text: body.body_text.trim() };
  } else {
    return NextResponse.json({ error: 'action must be approve, reject or edit' }, { status: 400 });
  }

  const { data, error } = await supabase.from('calldesk_outreach_messages').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}

// POST — send one draft or approved message (subject to the postal-address
// and suppression guards in sendApprovedMessage; approval is optional).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const result = await sendApprovedMessage(getSupabaseAdmin(), id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ sent: true, id: result.resendId });
}
