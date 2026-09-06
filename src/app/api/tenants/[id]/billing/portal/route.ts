import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/tenants/[id]/billing/portal — creates a Stripe Billing Portal
// session for the tenant's customer and returns its URL.
//
// This Stripe account is shared with the glp1-platform product (see the
// migration comment on the calldesk_ table prefix), so we must NOT reuse
// whatever portal configuration glp1 may have set as the account default —
// that could expose glp1's products/branding. Instead we look up (or
// lazily create) a configuration tagged with metadata.app === 'calldesktech'
// and always pin the session to it explicitly.

const PORTAL_CONFIG_TAG = 'calldesktech';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: business, error: dbError } = await supabase
    .from('calldesk_businesses')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }
  if (!business?.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No billing account found for this tenant.' },
      { status: 404 }
    );
  }

  try {
    const stripe = getStripe();

    // Find our own dedicated, active configuration; create one if it's the
    // first time. Tagged with metadata so we never latch onto another
    // product's config on this shared account.
    const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
    let config = existing.data.find(
      (c) => c.active && c.metadata?.app === PORTAL_CONFIG_TAG
    );

    if (!config) {
      config = await stripe.billingPortal.configurations.create({
        business_profile: {
          headline: 'CallDeskTech — manage your billing',
        },
        metadata: { app: PORTAL_CONFIG_TAG },
        features: {
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          customer_update: {
            enabled: true,
            allowed_updates: ['email', 'address', 'phone', 'tax_id'],
          },
          subscription_cancel: { enabled: true },
        },
      });
    }

    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: business.stripe_customer_id,
      configuration: config.id,
      return_url: returnUrl,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error('Billing portal session creation failed:', err);
    return NextResponse.json(
      { error: 'Failed to open the billing portal.' },
      { status: 500 }
    );
  }
}
