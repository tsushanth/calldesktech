import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { csvEscape } from '@/lib/outreach/smsConsent';

export const dynamic = 'force-dynamic';

const COLS = ['created_at', 'phone', 'sms_opt_in', 'sms_status', 'consent_version', 'consent_sha256', 'consent_text', 'ip', 'user_agent', 'product', 'message_id', 'lead_id', 'coupon_code', 'source'] as const;

const EVENT_COLS = ['created_at', 'phone', 'sms_opt_in', 'checkbox_default_checked', 'consent_version', 'consent_sha256', 'consent_text', 'form_sha256', 'form_copy', 'page_url', 'referrer', 'accept_language', 'ip', 'user_agent', 'product', 'message_id', 'lead_id', 'coupon_code', 'source'] as const;

// GET /api/admin/outreach/consents[?format=csv|events]: SMS consents captured on /try. format=events is the append-only audit log (one row per
// submission with the exact wording and form shown): the proof file for carriers or a dispute.
export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (request.nextUrl.searchParams.get('format') === 'events') {
    const ev = await getSupabaseAdmin().from('calldesk_sms_consent_events').select(EVENT_COLS.join(',')).order('created_at', { ascending: false }).limit(20000);
    if (ev.error) return NextResponse.json({ error: 'audit log unavailable (migration 071 not applied?)' }, { status: 500 });
    const evRows = (ev.data ?? []) as unknown as Record<string, unknown>[];
    const csv = [EVENT_COLS.join(','), ...evRows.map((r) => EVENT_COLS.map((c) => csvEscape(typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c])).join(','))].join('\n');
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sms-consent-audit-log.csv"' } });
  }
  const { data, error } = await getSupabaseAdmin().from('calldesk_sms_consents').select(COLS.join(',')).order('created_at', { ascending: false }).limit(5000);
  if (error) return NextResponse.json({ consents: [], note: 'consents unavailable (migration 070 not applied?)' });
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (request.nextUrl.searchParams.get('format') === 'csv') {
    const csv = [COLS.join(','), ...rows.map((r) => COLS.map((c) => csvEscape(r[c])).join(','))].join('\n');
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sms-consents.csv"' } });
  }
  return NextResponse.json({ consents: rows });
}
