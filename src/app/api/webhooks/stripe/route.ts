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
        const businessId = session.metadata?.business_id;
        const userId = session.metadata?.user_id;

        if (businessId) {
          // Update business subscription status
          await supabase
            .from('businesses')
            .update({
              subscription_status: 'active',
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              updated_at: new Date().toISOString(),
            })
            .eq('id', businessId);

          // Update user's default business
          if (userId) {
            await supabase
              .from('users')
              .update({
                default_business_id: businessId,
                updated_at: new Date().toISOString(),
              })
              .eq('id', userId);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const businessId = subscription.metadata?.business_id;

        if (businessId) {
          await supabase
            .from('businesses')
            .update({
              subscription_status: subscription.status,
              updated_at: new Date().toISOString(),
            })
            .eq('id', businessId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const businessId = subscription.metadata?.business_id;

        if (businessId) {
          await supabase
            .from('businesses')
            .update({
              subscription_status: 'canceled',
              updated_at: new Date().toISOString(),
            })
            .eq('id', businessId);
        }
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
