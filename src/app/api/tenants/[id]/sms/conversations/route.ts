import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// GET /api/tenants/[id]/sms/conversations — list SMS conversation threads.
// A thread is the unique set of messages between the tenant and one external
// phone number. Returns one row per thread with the latest message preview.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '25', 10), 200);

  const supabase = getSupabaseAdmin();

  // Fetch all tenant's SMS messages, newest first
  const { data: messages, error } = await supabase
    .from('calldesk_sms_messages')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group by the external phone number. For each thread, the "other party"
  // is the number that is NOT owned by the tenant. We don't strictly know
  // which numbers the tenant owns, but we can infer: if a message is outbound,
  // the "other" is `to_number`; if inbound, the "other" is `from_number`.
  const threadMap = new Map<string, {
    phoneNumber: string;
    lastMessageAt: string;
    preview: string;
    unreadCount: number;
    direction: string;
  }>();

  for (const m of messages || []) {
    const otherNumber = m.direction === 'outbound' ? m.to_number : m.from_number;
    const existing = threadMap.get(otherNumber);
    if (!existing) {
      threadMap.set(otherNumber, {
        phoneNumber: otherNumber,
        lastMessageAt: m.created_at,
        preview: m.body.slice(0, 100),
        unreadCount: m.direction === 'inbound' && !m.read_at ? 1 : 0,
        direction: m.direction,
      });
    } else {
      existing.unreadCount += m.direction === 'inbound' && !m.read_at ? 1 : 0;
    }
  }

  const threads = Array.from(threadMap.values())
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
    .slice(0, limit);

  return NextResponse.json({ conversations: threads });
}
