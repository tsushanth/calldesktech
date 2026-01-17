import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const RETELL_API_URL = 'https://api.retellai.com';

// POST /api/demo-call - Initiate an outbound demo call
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenant_id, phone_number, profile_id } = body;

    // Either tenant_id or profile_id must be provided
    if (!phone_number) {
      return NextResponse.json(
        { error: 'phone_number is required' },
        { status: 400 }
      );
    }

    if (!tenant_id && !profile_id) {
      return NextResponse.json(
        { error: 'Either tenant_id or profile_id is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    let agentId: string | null = null;
    let businessName: string = 'Demo Business';

    // If profile_id is provided, use the static demo agent
    if (profile_id) {
      const { data: demoAgent, error: demoAgentError } = await supabase
        .from('demo_agents')
        .select('*')
        .eq('profile_id', profile_id)
        .single();

      if (demoAgentError || !demoAgent) {
        return NextResponse.json(
          { error: `Demo agent for profile "${profile_id}" not found. Please initialize demo agents first.` },
          { status: 404 }
        );
      }

      agentId = demoAgent.retell_agent_id;
      businessName = demoAgent.business_name;
    } else if (tenant_id) {
      // Use the tenant's agent
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenant_id)
        .single();

      if (tenantError || !tenant) {
        return NextResponse.json(
          { error: 'Tenant not found' },
          { status: 404 }
        );
      }

      if (!tenant.retell_agent_id) {
        return NextResponse.json(
          { error: 'Tenant does not have an AI agent configured' },
          { status: 400 }
        );
      }

      agentId = tenant.retell_agent_id;
      businessName = tenant.name;
    }

    if (!agentId) {
      return NextResponse.json(
        { error: 'No agent available for this demo' },
        { status: 400 }
      );
    }

    // Initiate outbound call via Retell API
    const retellApiKey = process.env.RETELL_API_KEY;
    if (!retellApiKey) {
      return NextResponse.json(
        { error: 'Retell API key not configured' },
        { status: 500 }
      );
    }

    const demoPhoneNumber = process.env.RETELL_DEMO_PHONE_NUMBER;
    if (!demoPhoneNumber) {
      return NextResponse.json(
        { error: 'No phone number available for outbound calls. Please configure RETELL_DEMO_PHONE_NUMBER.' },
        { status: 500 }
      );
    }

    const callResponse = await fetch(`${RETELL_API_URL}/v2/create-phone-call`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${retellApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to_number: phone_number,
        from_number: demoPhoneNumber,
        override_agent_id: agentId,
        metadata: {
          tenant_id: tenant_id || null,
          profile_id: profile_id || null,
          demo: true,
          business_name: businessName,
        },
      }),
    });

    if (!callResponse.ok) {
      const errorText = await callResponse.text();
      console.error('Retell API error:', errorText);
      return NextResponse.json(
        { error: `Failed to initiate call: ${errorText}` },
        { status: callResponse.status }
      );
    }

    const callData = await callResponse.json();

    // Log the call in our database (only if we have a tenant_id)
    if (tenant_id) {
      await supabase.from('call_logs').insert({
        tenant_id: tenant_id,
        retell_call_id: callData.call_id,
        caller_phone: phone_number,
        outcome: 'answered', // Will be updated by webhook
        duration_seconds: 0,
      });
    }

    return NextResponse.json({
      success: true,
      call_id: callData.call_id,
      status: 'initiated',
      message: `Call initiated successfully to demo ${businessName}. You should receive a call shortly.`,
      business_name: businessName,
    });
  } catch (error) {
    console.error('Error initiating demo call:', error);
    return NextResponse.json(
      { error: 'Failed to initiate demo call' },
      { status: 500 }
    );
  }
}
