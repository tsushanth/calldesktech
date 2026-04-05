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
      .from('tenants')
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
    if (settings.subscription_status === 'active' && tenant.phone_number) {
      return NextResponse.json({
        success: true,
        phone_number: tenant.phone_number,
        message: 'Already activated',
      });
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

    // Provision phone number via Retell
    let phoneNumber: string | null = null;

    try {
      const retellApiKey = process.env.RETELL_API_KEY;
      if (!retellApiKey) {
        throw new Error('Retell API key not configured');
      }

      // Purchase a phone number from Retell
      const retellResponse = await fetch('https://api.retellai.com/v2/create-phone-number', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${retellApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // You can specify area_code here if desired
        }),
      });

      if (retellResponse.ok) {
        const retellData = await retellResponse.json();
        phoneNumber = retellData.phone_number;
      } else {
        console.error('Failed to provision phone number from Retell');
        // For now, use the shared demo number as fallback
        phoneNumber = process.env.RETELL_DEMO_PHONE_NUMBER || null;
      }
    } catch (err) {
      console.error('Retell phone provisioning error:', err);
      // Fallback to shared demo number
      phoneNumber = process.env.RETELL_DEMO_PHONE_NUMBER || null;
    }

    // Update tenant with active subscription and phone number
    const updatedSettings = {
      ...settings,
      subscription_status: 'active',
      activated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('tenants')
      .update({
        phone_number: phoneNumber,
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
      phone_number: phoneNumber,
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
