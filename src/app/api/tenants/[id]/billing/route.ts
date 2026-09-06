import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/tenants/[id]/billing — server-side (service-role Supabase +
// Stripe SDK). Returns the tenant's current plan, this-period usage,
// upcoming-invoice estimate, and the card on file, for the Billing page.
//
// The Stripe customer/subscription IDs live on calldesk_businesses, keyed by
// tenant_id (written by the Stripe webhook on checkout.session.completed and
// read the same way by syncVoicePriceForTenant in src/lib/stripe.ts). Like
// every other route under /api/tenants, this uses the service-role key
// because the app authenticates via NextAuth, not Supabase Auth, so anon-key
// RLS reads are always blocked here (see tenants/[id]/route.ts).

type UsageBreakdown = {
  calls: number;
  minutes: number;
  bookings: number;
  transfers: number;
  messages: number;
};

type BillingResponse = {
  hasSubscription: boolean;
  plan: {
    name: string;
    status: string;
    currentPeriodStart: number | null;
    currentPeriodEnd: number | null;
  } | null;
  usage: UsageBreakdown;
  upcomingInvoice: {
    amountDue: number;
    currency: string;
    periodEnd: number | null;
    lineItems: Array<{ description: string; amount: number }>;
  } | null;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  invoices: Array<{
    id: string;
    number: string | null;
    created: number;
    amountPaid: number;
    currency: string;
    status: string | null;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
  }>;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: business, error: dbError } = await supabase
    .from('calldesk_businesses')
    .select('stripe_customer_id, stripe_subscription_id, subscription_status')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  const emptyUsage: UsageBreakdown = { calls: 0, minutes: 0, bookings: 0, transfers: 0, messages: 0 };

  // No subscription yet — the tenant hasn't checked out. Return a well-formed
  // "nothing here yet" payload rather than 404 so the page can render its
  // empty state instead of an error.
  if (!business?.stripe_subscription_id || !business?.stripe_customer_id) {
    const response: BillingResponse = {
      hasSubscription: false,
      plan: null,
      usage: emptyUsage,
      upcomingInvoice: null,
      paymentMethod: null,
      invoices: [],
    };
    return NextResponse.json(response);
  }

  const stripe = getStripe();
  const customerId = business.stripe_customer_id;
  const subscriptionId = business.stripe_subscription_id;

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    });

    // Period fields moved from the Subscription object onto its items in
    // recent API versions (this app is on 2025-12-15.clover) — read them off
    // the first item.
    const firstItem = subscription.items.data[0];
    const periodStart = firstItem?.current_period_start ?? null;
    const periodEnd = firstItem?.current_period_end ?? null;

    // Plan name: the metered line items all sit on one product
    // ("CallDeskTech Usage"), so surface that product's name rather than a
    // per-line-item label.
    let planName = 'Usage-based plan';
    const product = firstItem?.price?.product;
    if (product && typeof product === 'object' && !('deleted' in product && product.deleted)) {
      planName = (product as Stripe.Product).name || planName;
    }

    // Usage this billing period, from our own call logs (accurate to what we
    // actually recorded, and independent of meter-event delivery). Mirrors
    // the metered dimensions: voice minutes + completed actions.
    let usage = emptyUsage;
    if (periodStart) {
      const { data: callLogs } = await supabase
        .from('calldesk_call_logs')
        .select('duration_seconds, outcome')
        .eq('tenant_id', tenantId)
        .gte('created_at', new Date(periodStart * 1000).toISOString());

      if (callLogs) {
        const totalSeconds = callLogs.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
        usage = {
          calls: callLogs.length,
          minutes: Math.round(totalSeconds / 60),
          bookings: callLogs.filter((c) => c.outcome === 'booked').length,
          transfers: callLogs.filter((c) => c.outcome === 'transferred').length,
          messages: callLogs.filter((c) => c.outcome === 'voicemail').length,
        };
      }
    }

    // Upcoming invoice estimate — authoritative dollar figure, aggregated by
    // Stripe from the metered usage reported against this subscription.
    // retrieveUpcoming was removed in the Stripe SDK major this app uses;
    // createPreview is its replacement.
    let upcomingInvoice: BillingResponse['upcomingInvoice'] = null;
    try {
      const preview = await stripe.invoices.createPreview({
        customer: customerId,
        subscription: subscriptionId,
      });
      upcomingInvoice = {
        amountDue: preview.amount_due,
        currency: preview.currency,
        periodEnd: preview.period_end ?? null,
        lineItems: preview.lines.data
          .map((line) => ({
            description: line.description || 'Usage',
            amount: line.amount,
          }))
          // Drop $0 metered lines so the estimate isn't padded with unused
          // dimensions.
          .filter((line) => line.amount !== 0),
      };
    } catch (previewErr) {
      // A preview can fail (e.g. subscription in an odd state); the rest of
      // the page is still useful, so degrade gracefully rather than 500.
      console.error('Upcoming invoice preview failed:', previewErr);
    }

    // Card on file — prefer the customer's default, fall back to the first
    // attached card.
    let paymentMethod: BillingResponse['paymentMethod'] = null;
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    let card: Stripe.PaymentMethod.Card | null = null;
    if (customer && !customer.deleted) {
      const defaultPm = customer.invoice_settings?.default_payment_method;
      if (defaultPm && typeof defaultPm === 'object' && defaultPm.card) {
        card = defaultPm.card;
      }
    }
    if (!card) {
      const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
      card = methods.data[0]?.card ?? null;
    }
    if (card) {
      paymentMethod = {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.exp_month,
        expYear: card.exp_year,
      };
    }

    // Invoice history — most recent first.
    const invoiceList = await stripe.invoices.list({ customer: customerId, limit: 12 });
    const invoices = invoiceList.data.map((inv) => ({
      id: inv.id ?? '',
      number: inv.number ?? null,
      created: inv.created,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      status: inv.status ?? null,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));

    const response: BillingResponse = {
      hasSubscription: true,
      plan: {
        name: planName,
        status: subscription.status,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      usage,
      upcomingInvoice,
      paymentMethod,
      invoices,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error('Billing fetch failed:', err);
    return NextResponse.json({ error: 'Failed to load billing details' }, { status: 500 });
  }
}
