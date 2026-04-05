import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStripe, STRIPE_CONFIG } from '@/lib/stripe';
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
      .from('tenants')
      .select('*')
      .eq('id', business_id)
      .single();

    if (dbError || !tenant) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    // Create Stripe checkout session
    const stripe = getStripe();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: STRIPE_CONFIG.priceId,
          quantity: 1,
        },
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
