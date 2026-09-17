import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';
import Stripe from 'stripe';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature || !webhookSecret) {
      return NextResponse.json(
        { error: 'Missing signature or webhook secret' },
        { status: 400 }
      );
    }

    let event: Stripe.Event;
    const stripe = getStripe();

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        // `business_id` in checkout metadata is actually the tenant id (see
        // checkout/route.ts — it's looked up against calldesk_tenants.id).
        const tenantId = session.metadata?.business_id;
        const userId = session.metadata?.user_id;

        if (tenantId) {
          const stripeCustomerId = session.customer as string;
          const stripeSubscriptionId = session.subscription as string;

          // Upsert the tenant's billing record. This handler previously only
          // ran .update() keyed by `id`, so the row was never created and,
          // even if it had been, it was keyed inconsistently with how the
          // rest of the app reads it (by tenant_id — see
          // syncVoicePriceForTenant and /api/tenants/[id]/billing). Upserting
          // on tenant_id fixes both. Requires the UNIQUE(tenant_id)
          // constraint from migration 006.
          const { data: business, error: upsertError } = await supabase
            .from('calldesk_businesses')
            .upsert(
              {
                tenant_id: tenantId,
                subscription_status: 'active',
                stripe_customer_id: stripeCustomerId,
                stripe_subscription_id: stripeSubscriptionId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'tenant_id' }
            )
            .select('id')
            .single();

          if (upsertError) {
            console.error('Failed to upsert business on checkout:', upsertError);
          }

          // Point the user at their billing record. default_business_id is an
          // FK to calldesk_businesses(id), so it must be the row's real id —
          // not the tenant id (the old code stored the tenant id here, which
          // could never satisfy the FK).
          if (userId && business) {
            await supabase
              .from('calldesk_users')
              .update({
                default_business_id: business.id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', userId);
          }

          // Account-level billing (2026-09-17): one subscription is shared
          // across every workspace a user owns, matching Retell's own model
          // — adding a new workspace never re-asks for payment info if the
          // account already has billing. calldesk_users is the real source
          // of truth now; calldesk_businesses rows (including the one just
          // upserted above) are kept as per-tenant MIRRORS of it so every
          // existing tenant-keyed read site (paymentMethodGate.ts, both
          // billing routes, call-loop-poc's stripeMeter.js/tenantLookup.js)
          // needed zero changes.
          if (userId) {
            await supabase
              .from('calldesk_users')
              .update({
                stripe_customer_id: stripeCustomerId,
                stripe_subscription_id: stripeSubscriptionId,
                subscription_status: 'active',
                updated_at: new Date().toISOString(),
              })
              .eq('id', userId);

            // Backfill every OTHER tenant this user already owns so
            // pre-existing sibling workspaces inherit billing immediately,
            // not just the one that happened to check out.
            const { data: siblingTenants } = await supabase
              .from('calldesk_tenants')
              .select('id')
              .eq('user_id', userId)
              .neq('id', tenantId);
            for (const sibling of siblingTenants || []) {
              await supabase
                .from('calldesk_businesses')
                .upsert(
                  {
                    tenant_id: sibling.id,
                    subscription_status: 'active',
                    stripe_customer_id: stripeCustomerId,
                    stripe_subscription_id: stripeSubscriptionId,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: 'tenant_id' }
                );
            }
          }
        }
        break;
      }

      // Both handlers below cascade by stripe_subscription_id rather than
      // the original checkout's tenant_id metadata — since one subscription
      // is now shared across every tenant a user owns (see
      // checkout.session.completed above), a status change has to update
      // every calldesk_businesses row mirroring it, not just the single
      // tenant that happened to originate the checkout.
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await supabase
          .from('calldesk_businesses')
          .update({ subscription_status: subscription.status, updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        await supabase
          .from('calldesk_users')
          .update({ subscription_status: subscription.status, updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await supabase
          .from('calldesk_businesses')
          .update({ subscription_status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        await supabase
          .from('calldesk_users')
          .update({ subscription_status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}
