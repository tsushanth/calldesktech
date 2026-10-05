import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { csvEscape } from '@/lib/outreach/smsConsent';

export const dynamic = 'force-dynamic';

const COLS = ['created_at', 'phone', 'sms_opt_in', 'sms_status', 'consent_version', 'consent_text', 'ip', 'user_agent', 'product', 'message_id', 'lead_id', 'coupon_code', 'source'] as const;

// GET /api/admin/outreach/consents[?format=csv]: SMS consents captured on /try. The CSV is the proof file for carriers or a dispute.
export async function GET(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().from('calldesk_sms_consents').select(COLS.join(',')).order('created_at', { ascending: false }).limit(5000);
  if (error) return NextResponse.json({ consents: [], note: 'consents unavailable (migration 070 not applied?)' });
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (request.nextUrl.searchParams.get('format') === 'csv') {
    const csv = [COLS.join(','), ...rows.map((r) => COLS.map((c) => csvEscape(r[c])).join(','))].join('\n');
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sms-consents.csv"' } });
  }
  return NextResponse.json({ consents: rows });
}
