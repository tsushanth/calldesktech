import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getMobileUser } from '@/lib/mobile-auth';

// Valid coupon codes for activation
const VALID_COUPONS = ['SUSH', 'BETA', 'EARLY'];

export async function POST(request: NextRequest) {
  try {
    // Dual auth: try NextAuth session first, fall back to mobile Bearer token
    const session = await getServerSession(authOptions);
    let userId = session?.user?.id;

    if (!userId) {
      const mobileUser = await getMobileUser(request);
      userId = mobileUser?.id;
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { business_id, session_id, coupon_code } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Verify business ownership (using tenants table)
    const { data: tenant, error: fetchError } = await supabase
      .from('calldesk_tenants')
      .select('*')
      .eq('id', business_id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !tenant) {
      return NextResponse.json(
        { error: 'Business not found or access denied' },
        { status: 404 }
      );
    }

    // Check if already activated (subscription_status stored in settings)
    const settings = tenant.settings || {};
    if (settings.subscription_status === 'active') {
      return NextResponse.json({ success: true, message: 'Already activated' });
    }

    // Validate payment - either Stripe session or coupon
    let isValidPayment = false;

    if (coupon_code) {
      isValidPayment = VALID_COUPONS.includes(coupon_code.toUpperCase());
      if (!isValidPayment) {
        return NextResponse.json(
          { error: 'Invalid coupon code' },
          { status: 400 }
        );
      }
    } else if (session_id) {
      // In production, verify session with Stripe
      // For now, we trust the session ID exists
      isValidPayment = true;
    } else {
      return NextResponse.json(
        { error: 'Payment verification required' },
        { status: 400 }
      );
    }

    // Real bug fixed 2026-09-17: this used to unconditionally purchase a
    // real phone number from Retell on every activation, silently falling
    // back to a SHARED demo number (RETELL_DEMO_PHONE_NUMBER) whenever the
    // purchase failed — which is why the same number kept showing up
    // "assigned" repeatedly. Getting a number is a deliberate action on the
    // Phone Numbers page now (buy one or register one you own), not a side
    // effect of checkout/coupon activation — this endpoint only marks
    // billing active.
    const updatedSettings = {
      ...settings,
      subscription_status: 'active',
      activated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('calldesk_tenants')
      .update({
        settings: updatedSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', business_id);

    if (updateError) {
      console.error('Error updating business:', updateError);
      return NextResponse.json(
        { error: 'Failed to activate subscription' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Service activated successfully',
    });
  } catch (error) {
    console.error('Go-live error:', error);
    return NextResponse.json(
      { error: 'Failed to activate service' },
      { status: 500 }
    );
  }
}
