import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { createBusinessTenant, attachExistingAccountBilling } from '@/lib/tenantProvisioning';

// GET /api/tenants - List all tenants for the current user.
// Was previously trusting a client-supplied `x-user-id` header — any caller
// could pass any user's id and list their tenants. Uses the real session
// now; this is also what lets the dashboard find "your" tenant just from
// being logged in, instead of only from a localStorage value stamped
// during onboarding (which a fresh sign-in, or a tenant created directly in
// Supabase, would never have).
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenants, error } = await supabase
      .from('calldesk_tenants')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ tenants });
  } catch (error) {
    console.error('Error fetching tenants:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tenants' },
      { status: 500 }
    );
  }
}

// POST /api/tenants - Create a new tenant (business)
// Was trusting a client-supplied `x-user-id` header, same spoofable pattern
// GET on this route had (see its comment) — any caller could create tenants
// (and, with an areaCode, trigger a real Retell phone number purchase) under
// any user id. Uses the real session now.
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, areaCode, voiceEngine, workspaceType } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Business name is required' },
        { status: 400 }
      );
    }

    // A tenant created for the in-house "poc" engine never places a real
    // Retell call, so provisioning Retell's LLM/Agent/phone-number resources
    // for it would just be wasted API calls (and, for a purchased number,
    // real cost) — skip straight to a bare tenant row instead. This is what
    // lets voiceEngine be known and persisted before the tenant's very first
    // demo call, rather than only after a later Settings-page edit. The
    // "Add another workspace" flow always creates a poc-engine tenant for
    // the same reason — a second workspace shouldn't silently provision (and
    // bill for) real Retell resources before its owner has configured it.
    if (voiceEngine === 'poc') {
      console.log('Creating poc-engine tenant (no Retell resources)...');
      const { data: tenant, error } = await supabase
        .from('calldesk_tenants')
        .insert({
          user_id: userId,
          name,
          settings: { voice_engine: 'poc', ...(workspaceType ? { workspace_type: workspaceType } : {}) },
        })
        .select()
        .single();

      if (error) {
        console.error('Supabase error:', error);
        return NextResponse.json(
          { error: `Database error: ${error.message}` },
          { status: 500 }
        );
      }

      console.log('Tenant created:', tenant.id);
      await attachExistingAccountBilling(tenant.id, userId);
      return NextResponse.json({ tenant }, { status: 201 });
    }

    // Delegates the same KB/LLM/Agent/tenant/default-flow sequence
    // /api/business uses — this branch used to duplicate it with drift (see
    // src/lib/tenantProvisioning.ts's header comment). Only reached when
    // voiceEngine !== 'poc' (see the branch above), so this is always the
    // Retell demo path — explicit voiceEngine: 'retell' since
    // createBusinessTenant now defaults to 'poc' otherwise.
    const { tenant: createdTenant, agentId } = await createBusinessTenant({ userId, name, voiceEngine: 'retell' });
    if (!agentId) {
      return NextResponse.json({ error: 'Failed to provision Retell agent for demo tenant' }, { status: 500 });
    }

    // Phone number handling — this branch is currently only reachable from
    // the demo flow (see OnboardingContext.tsx), never from real account
    // onboarding, so a real purchase here is effectively demo-only today.
    // For demos, we don't purchase a number - we use a shared demo number configured in env
    // For production tenants, they would purchase their own number
    let phoneNumber: string | null = null;
    if (areaCode) {
      console.log('Purchasing phone number with area code:', areaCode);
      try {
        const retell = getRetellClient();
        const phoneResult = await retell.purchasePhoneNumber(areaCode);
        phoneNumber = phoneResult.phone_number;
        await retell.assignPhoneNumberToAgent(phoneNumber, agentId);
        console.log('Phone number assigned:', phoneNumber);
        await supabase.from('calldesk_tenants').update({ phone_number: phoneNumber }).eq('id', createdTenant.id);
      } catch (phoneError) {
        console.error('Failed to purchase phone number:', phoneError);
      }
    }

    const { data: tenant, error: fetchError } = await supabase
      .from('calldesk_tenants')
      .select('*')
      .eq('id', createdTenant.id)
      .single();

    if (fetchError) {
      console.error('Supabase error:', fetchError);
      return NextResponse.json(
        { error: `Database error: ${fetchError.message}` },
        { status: 500 }
      );
    }

    console.log('Tenant created:', tenant.id);

    return NextResponse.json({ tenant }, { status: 201 });
  } catch (error) {
    console.error('Error creating tenant:', error);
    const message = error instanceof Error ? error.message : 'Failed to create business';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

