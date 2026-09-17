import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getMobileUser } from '@/lib/mobile-auth';
import { createBusinessTenant } from '@/lib/tenantProvisioning';

export async function POST(request: NextRequest) {
  try {
    // Dual auth: try NextAuth session first, fall back to mobile Bearer token
    const session = await getServerSession(authOptions);
    let userId = session?.user?.id;
    let userEmail = session?.user?.email;

    if (!userId) {
      const mobileUser = await getMobileUser(request);
      userId = mobileUser?.id;
      userEmail = mobileUser?.email;
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      name,
      email,
      business_type,
      description,
      website,
      address,
      phone,
      hours,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Business name is required' },
        { status: 400 }
      );
    }

    const { tenant } = await createBusinessTenant({
      userId,
      name,
      email: email || userEmail,
      businessType: business_type,
      description,
      website,
      address,
      phone,
      hours,
    });

    console.log('Business created:', tenant.id);

    return NextResponse.json({
      id: tenant.id,
      name: tenant.name,
    });
  } catch (error) {
    console.error('Business creation error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create business';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
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

    const supabase = getSupabaseAdmin();

    // Get user's businesses (tenants)
    const { data: businesses, error } = await supabase
      .from('calldesk_tenants')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching businesses:', error);
      return NextResponse.json(
        { error: 'Failed to fetch businesses' },
        { status: 500 }
      );
    }

    return NextResponse.json({ businesses: businesses || [] });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch businesses' },
      { status: 500 }
    );
  }
}
