import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStripe, STRIPE_CONFIG } from '@/lib/stripe';
import { USAGE_PRICES } from '@/lib/constants';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getMobileUser } from '@/lib/mobile-auth';

export async function POST(request: NextRequest) {
  try {
    // Dual auth: try NextAuth session first, fall back to mobile Bearer token
    const session = await getServerSession(authOptions);
    let userEmail = session?.user?.email;
    let userId = session?.user?.id;

    if (!userEmail) {
      const mobileUser = await getMobileUser(request);
      userEmail = mobileUser?.email;
      userId = mobileUser?.id;
    }

    if (!userEmail) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { business_id } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    // Get business details from database (using tenants table)
    const supabase = getSupabaseAdmin();
    const { data: tenant, error: dbError } = await supabase
      .from('calldesk_tenants')
      .select('*')
      .eq('id', business_id)
      .single();

    if (dbError || !tenant) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    // Create Stripe checkout session — usage-based, not the old flat plan
    // (see PRICING/USAGE_PRICES in constants.ts, 2026-08-26 pricing switch).
    // Metered-price line items take no quantity; Stripe bills them from
    // meter events reported by call-loop-poc (see stripeMeter.js there).
    // Voice defaults to the kokoro price — the tenant's agent version can
    // only pick elevenlabs after the agent exists, which happens after this
    // checkout completes; switching an active subscription's voice price to
    // match a later elevenlabs choice is a real follow-up, not done yet.
    const stripe = getStripe();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      // Lets Stripe's own hosted checkout page show a promo-code field —
      // replaces the old client-side coupon bypass (SUSH/BETA/EARLY, a
      // hardcoded list in the shipped JS that set subscription_status
      // active with zero Stripe involvement at all). A real promotion code
      // still requires a card and is tracked/capped by Stripe itself.
      allow_promotion_codes: true,
      line_items: [
        { price: USAGE_PRICES.voice.kokoro },
        { price: USAGE_PRICES.booking },
        { price: USAGE_PRICES.transfer },
        { price: USAGE_PRICES.message },
      ],
      success_url: STRIPE_CONFIG.successUrl,
      cancel_url: STRIPE_CONFIG.cancelUrl,
      customer_email: userEmail,
      metadata: {
        business_id,
        user_id: userId || '',
      },
      subscription_data: {
        metadata: {
          business_id,
          user_id: userId || '',
        },
      },
    });

    return NextResponse.json({
      checkout_url: checkoutSession.url,
      session_id: checkoutSession.id,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
