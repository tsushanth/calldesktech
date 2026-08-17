import { NextRequest, NextResponse } from 'next/server';
import { getMobileUser } from '@/lib/mobile-auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/mobile/settings?tenant_id=
 *
 * Returns tenant details for the settings page.
 */
export async function GET(request: NextRequest) {
  try {
    const mobileUser = await getMobileUser(request);
    if (!mobileUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = request.nextUrl.searchParams.get('tenant_id');
    if (!tenantId) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: tenant, error } = await supabase
      .from('calldesk_tenants')
      .select('*')
      .eq('id', tenantId)
      .eq('user_id', mobileUser.id)
      .single();

    if (error || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    return NextResponse.json(tenant);
  } catch (error) {
    console.error('Settings error:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

/**
 * PUT /api/mobile/settings
 *
 * Updates tenant name and settings (voice, tone, business info).
 */
export async function PUT(request: NextRequest) {
  try {
    const mobileUser = await getMobileUser(request);
    if (!mobileUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { tenant_id, name, settings } = body;

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Verify ownership
    const { data: existing } = await supabase
      .from('calldesk_tenants')
      .select('id, settings')
      .eq('id', tenant_id)
      .eq('user_id', mobileUser.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Merge settings
    const updatedSettings = {
      ...(existing.settings || {}),
      ...(settings || {}),
    };

    const updateData: Record<string, unknown> = {
      settings: updatedSettings,
      updated_at: new Date().toISOString(),
    };

    if (name) {
      updateData.name = name;
    }

    const { data: updated, error } = await supabase
      .from('calldesk_tenants')
      .update(updateData)
      .eq('id', tenant_id)
      .select()
      .single();

    if (error) {
      console.error('Settings update error:', error);
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Settings error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
