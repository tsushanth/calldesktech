import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/sms/conversations/[phoneNumber] — all messages in
// a thread, plus mark inbound as read. Direction-agnostic: returns both
// inbound and outbound between this tenant and the given phone number.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phoneNumber: string }> }
) {
  const { id: tenantId, phoneNumber } = await params;
  const __auth = await authorizeTenant(request, tenantId);
  if (!__auth.ok) return __auth.response;

  const normalized = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
  const supabase = getSupabaseAdmin();

  // Messages where this tenant is either sender or receiver
  const { data: messages, error } = await supabase
    .from('calldesk_sms_messages')
    .select('*')
    .eq('tenant_id', tenantId)
    .or(`from_number.eq.${normalized},to_number.eq.${normalized}`)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mark unread inbound messages as read
  const unreadIds = (messages || [])
    .filter((m) => m.direction === 'inbound' && !m.read_at)
    .map((m) => m.id);
  if (unreadIds.length > 0) {
    await supabase
      .from('calldesk_sms_messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadIds);
  }

  return NextResponse.json({ messages: messages || [], phoneNumber: normalized });
}
