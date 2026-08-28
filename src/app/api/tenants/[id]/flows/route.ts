import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient, flowToRetellPrompt, flowToRetellTools } from '@/lib/retell';

// GET /api/tenants/[id]/flows - Get flows for a tenant
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: flows, error } = await supabase
      .from('calldesk_conversation_flows')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ flows });
  } catch (error) {
    console.error('Error fetching flows:', error);
    return NextResponse.json(
      { error: 'Failed to fetch flows' },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[id]/flows - Create a new flow
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const supabase = getSupabaseAdmin();
    const body = await request.json();

    const { name, nodes, globalSettings } = body;

    const { data: flow, error } = await supabase
      .from('calldesk_conversation_flows')
      .insert({
        tenant_id: tenantId,
        name,
        nodes: nodes || [],
        global_settings: globalSettings || {
          allowInterruptions: true,
          returnToFlow: true,
        },
        is_active: false,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ flow }, { status: 201 });
  } catch (error) {
    console.error('Error creating flow:', error);
    return NextResponse.json(
      { error: 'Failed to create flow' },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[id]/flows - Activate a flow (sync to Retell)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const supabase = getSupabaseAdmin();
    const retell = getRetellClient();
    const body = await request.json();

    const { flowId } = body;

    // Get tenant and flow
    const [tenantResult, flowResult] = await Promise.all([
      supabase.from('calldesk_tenants').select('*').eq('id', tenantId).single(),
      supabase.from('calldesk_conversation_flows').select('*').eq('id', flowId).single(),
    ]);

    if (tenantResult.error || !tenantResult.data) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    if (flowResult.error || !flowResult.data) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
    }

    const tenant = tenantResult.data;
    const flow = flowResult.data;

    // Convert flow to Retell prompt format
    const flowObj = {
      id: flow.id,
      tenantId: flow.tenant_id,
      name: flow.name,
      nodes: flow.nodes as unknown as import('@/types').FlowNode[],
      globalSettings: flow.global_settings as unknown as import('@/types').GlobalSettings,
      isActive: flow.is_active,
      version: flow.version,
      createdAt: new Date(flow.created_at),
      updatedAt: new Date(flow.updated_at),
    };
    const prompt = flowToRetellPrompt(flowObj);
    const generalTools = flowToRetellTools(flowObj);

    // Update Retell LLM with new prompt
    if (tenant.retell_llm_id) {
      await retell.updateLLM(tenant.retell_llm_id, {
        generalPrompt: prompt,
        knowledgeBaseIds: tenant.knowledge_base_id ? [tenant.knowledge_base_id] : undefined,
        generalTools: generalTools.length > 0 ? generalTools : undefined,
      });
    }

    // Deactivate all other flows and activate this one
    await supabase
      .from('calldesk_conversation_flows')
      .update({ is_active: false })
      .eq('tenant_id', tenantId);

    await supabase
      .from('calldesk_conversation_flows')
      .update({ is_active: true, version: flow.version + 1 })
      .eq('id', flowId);

    return NextResponse.json({ success: true, message: 'Flow activated and synced to Retell' });
  } catch (error) {
    console.error('Error activating flow:', error);
    return NextResponse.json(
      { error: 'Failed to activate flow' },
      { status: 500 }
    );
  }
}
