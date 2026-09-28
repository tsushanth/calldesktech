import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { isCronRequest, requireAdminSession } from '@/lib/outreach/adminAuth';
import { runUsageReportingJob } from '@/lib/reportUsageToStripe';

// POST /api/admin/billing/report-usage — reports each tenant's metered
// usage (voice minutes + booking/transfer/message events) since its
// last_usage_reported_at to Stripe, via subscriptionItems.createUsageRecord
// against that tenant's subscription. See reportUsageToStripe.ts for the
// mechanism choice and idempotency design.
//
// Same auth pattern as the other cron-driven admin routes (e.g.
// admin/outreach/autosend): CRON_SECRET bearer token for the scheduled
// runner, or an admin session for a manual trigger. No GitHub Actions
// workflow ships with this route — a human still needs to add one (see
// .github/workflows/outreach-*.yml for the pattern) to actually schedule it.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authorized = isCronRequest(request) || !!(await requireAdminSession());
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const stripe = getStripe();

  try {
    const { results } = await runUsageReportingJob(supabase, stripe);
    return NextResponse.json({ results });
  } catch (err) {
    console.error('[report-usage] job failed:', err);
    return NextResponse.json({ error: 'Usage reporting job failed' }, { status: 500 });
  }
}
