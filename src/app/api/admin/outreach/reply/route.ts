import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isCronRequest, requireAdminSession } from '@/lib/outreach/adminAuth';
import { sendManualReply } from '@/lib/outreach/manualSend';

// Sends one email from the outreach address (a reply to a prospect or partner) and logs it.
// Auth: the admin session, or Authorization: Bearer CRON_SECRET (used by Claude from the Fly machine).
//   POST { to, subject, body | proposal, brand?: 'calldesk'|'readaloud', inReplyTo?, leadId?, bcc?, allowNonAscii? }
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const admin = isCronRequest(request) ? { email: 'cron' } : await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const input = await request.json().catch(() => null);
  const result = await sendManualReply(getSupabaseAdmin(), input, { sentBy: admin.email });
  if (!result.ok) {
    const bad = /must|required|non-ASCII|contains|not configured|unsubscribed|suppressed|only available/.test(result.error);
    return NextResponse.json({ error: result.error }, { status: bad ? 400 : 502 });
  }
  return NextResponse.json(result);
}
