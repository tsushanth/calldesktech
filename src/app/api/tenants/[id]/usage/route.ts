import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';
import { getStripe } from '@/lib/stripe';
import { summarizeCallLogs } from '@/lib/usage';

// GET /api/tenants/[id]/usage — billing and usage breakdown.
// Aggregates from calldesk_call_logs, calldesk_sms_messages, and
// calldesk_phone_numbers for a date range. Also pulls actual Stripe invoice
// totals so callers can compare "what we estimate" vs "what you actually paid".
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;
  const tenantId = (await params).id;
  const { searchParams } = new URL(request.url);

  const today = new Date().toISOString().split('T')[0];
  const startDate = (searchParams.get('startDate') ?? today.slice(0, 8) + '01');
  const endDate = (searchParams.get('endDate') ?? today);
  const granularity = (searchParams.get('granularity') ?? 'day') as 'day' | 'month';

  const supabase = getSupabaseAdmin();

  // Call minutes
  const { data: callsAgg } = await supabase
    .from('calldesk_call_logs')
    .select('created_at, duration_seconds, outcome')
    .eq('tenant_id', tenantId)
    .gte('created_at', `${startDate}T00:00:00Z`)
    .lte('created_at', `${endDate}T23:59:59Z`);

  const callSummary = summarizeCallLogs(callsAgg || []);
  const callMinutes = callSummary.minutes;
  const bookings = callSummary.bookings;
  const transfers = callSummary.transfers;

  // SMS counts (both directions)
  const { data: outboundSms } = await supabase
    .from('calldesk_sms_messages')
    .select('created_at, body')
    .eq('tenant_id', tenantId)
    .eq('direction', 'outbound')
    .gte('created_at', `${startDate}T00:00:00Z`)
    .lte('created_at', `${endDate}T23:59:59Z`);
  const { data: inboundSms } = await supabase
    .from('calldesk_sms_messages')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .gte('created_at', `${startDate}T00:00:00Z`)
    .lte('created_at', `${endDate}T23:59:59Z`);

  const smsOutbound = (outboundSms || []).length;
  const smsInbound = (inboundSms || []).length;
  const smsSegments = smsOutbound; // Approximate: Telnyx bills per segment

  // Number rental
  const { count: numberCount } = await supabase
    .from('calldesk_phone_numbers')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  const numberCost = (numberCount ?? 0) * 2.0;

  // Pull actual Stripe invoices for this tenant
  let stripeActuals: { invoicesFound: number; totalPaid: number; currency: string; invoiceDetails: Array<{ id: string; amountPaid: number; periodStart: string; periodEnd: string; status: string | null }> } | null = null;

  const { data: business } = await supabase
    .from('calldesk_businesses')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (business?.stripe_customer_id) {
    try {
      const stripe = getStripe();
      const startTimestamp = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
      const endTimestamp = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);

      const invoiceList = await stripe.invoices.list({
        customer: business.stripe_customer_id,
        limit: 100,
      });

      const relevant = invoiceList.data.filter((inv) => {
        const created = inv.created;
        return created >= startTimestamp && created <= endTimestamp && inv.status === 'paid';
      });

      stripeActuals = {
        invoicesFound: relevant.length,
        totalPaid: relevant.reduce((sum, inv) => sum + inv.amount_paid, 0),
        currency: relevant[0]?.currency || 'usd',
        invoiceDetails: relevant.map((inv) => ({
          id: inv.id,
          amountPaid: inv.amount_paid,
          periodStart: new Date(inv.period_start * 1000).toISOString().split('T')[0],
          periodEnd: new Date(inv.period_end * 1000).toISOString().split('T')[0],
          status: inv.status,
        })),
      };
    } catch (err) {
      console.error('[usage] Stripe invoice fetch failed:', err);
      stripeActuals = null;
    }
  }

  // Granular series
  const seriesMap = new Map<string, { callMinutes: number; smsOutbound: number; smsInbound: number }>();
  const dateKey = (date: string) => {
    const d = new Date(date);
    return granularity === 'month'
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : date.split('T')[0];
  };

  for (const c of callsAgg || []) {
    const key = dateKey(c.created_at);
    const entry = seriesMap.get(key) ?? { callMinutes: 0, smsOutbound: 0, smsInbound: 0 };
    entry.callMinutes += Math.round((c.duration_seconds ?? 0) / 60);
    seriesMap.set(key, entry);
  }
  for (const s of outboundSms || []) {
    const key = dateKey(s.created_at);
    const entry = seriesMap.get(key) ?? { callMinutes: 0, smsOutbound: 0, smsInbound: 0 };
    entry.smsOutbound += 1;
    seriesMap.set(key, entry);
  }
  for (const s of inboundSms || []) {
    const key = dateKey(s.created_at);
    const entry = seriesMap.get(key) ?? { callMinutes: 0, smsOutbound: 0, smsInbound: 0 };
    entry.smsInbound += 1;
    seriesMap.set(key, entry);
  }

  const series = Array.from(seriesMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return NextResponse.json({
    startDate,
    endDate,
    granularity,
    totals: {
      callMinutes,
      bookings,
      transfers,
      smsOutbound,
      smsInbound,
      smsSegments,
      numberCost,
    },
    series,
    stripeActuals: stripeActuals ?? undefined,
  });
}
