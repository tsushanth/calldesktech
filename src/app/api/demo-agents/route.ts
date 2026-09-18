import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient, flowToRetellPrompt, flowToRetellTools } from '@/lib/retell';
import { CAPABILITY_DEMOS, type DemoProfileId } from '@/lib/constants';
import { buildWizardFlow, buildSingleBlockDemoFlow, type WizardBlocks } from '@/lib/flowBuilder';
import { requireAuth } from '@/lib/authz';

// GET /api/demo-agents - Get all demo agents
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data: agents, error } = await supabase
      .from('calldesk_demo_agents')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({ agents: agents || [] });
  } catch (error) {
    console.error('Error fetching demo agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch demo agents' },
      { status: 500 }
    );
  }
}

// DELETE /api/demo-agents - Delete all demo agents (admin only, for recreating with KB)
export async function DELETE(request: NextRequest) {
  const __auth = await requireAuth(request);
  if (!__auth.ok) return __auth.response;

  try {
    // Simple auth check
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.RETELL_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const retell = getRetellClient();

    // Get all demo agents
    const { data: agents, error: fetchError } = await supabase
      .from('calldesk_demo_agents')
      .select('*');

    if (fetchError) {
      throw fetchError;
    }

    const results: { profile: string; success: boolean; error?: string }[] = [];

    // Delete each agent from Retell and database
    for (const agent of agents || []) {
      try {
        // Delete from Retell (agent, LLM, KB)
        if (agent.retell_agent_id) {
          await retell.deleteAgent(agent.retell_agent_id).catch(() => {});
        }
        if (agent.retell_llm_id) {
          await retell.deleteLLM(agent.retell_llm_id).catch(() => {});
        }
        if (agent.retell_kb_id) {
          await retell.deleteKnowledgeBase(agent.retell_kb_id).catch(() => {});
        }

        // Delete from database
        await supabase.from('calldesk_demo_agents').delete().eq('id', agent.id);

        results.push({ profile: agent.profile_id, success: true });
      } catch (err) {
        results.push({
          profile: agent.profile_id,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      message: 'Demo agents deletion complete',
      results,
    });
  } catch (error) {
    console.error('Error deleting demo agents:', error);
    return NextResponse.json(
      { error: 'Failed to delete demo agents' },
      { status: 500 }
    );
  }
}

// POST /api/demo-agents - Initialize demo agents (admin only, run once)
export async function POST(request: NextRequest) {
  const __auth = await requireAuth(request);
  if (!__auth.ok) return __auth.response;

  try {
    // Simple auth check - in production, use proper admin auth
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.RETELL_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const retell = getRetellClient();

    const results: { profile: string; success: boolean; error?: string }[] = [];

    // Process each demo profile
    for (const [profileId, profile] of Object.entries(CAPABILITY_DEMOS) as [DemoProfileId, typeof CAPABILITY_DEMOS[DemoProfileId]][]) {
      try {
        // Check if already exists
        const { data: existing } = await supabase
          .from('calldesk_demo_agents')
          .select('id')
          .eq('profile_id', profileId)
          .single();

        if (existing) {
          results.push({ profile: profileId, success: true, error: 'Already exists' });
          continue;
        }

        // Build the SAME kind of flow a real tenant would get from the
        // building-block wizard — buildSingleBlockDemoFlow forces every
        // block off except the one this capability demos, so the flattened
        // prompt showcases exactly that one capability in isolation. This
        // makes the demo agent behaviorally representative of what a real
        // customer's own agent looks like, not a bespoke demo-only prompt.
        const block = profile.block as keyof WizardBlocks | null;
        // Transfers back to our own shared demo line — real prospects
        // shouldn't be routed to a private number, and this needs nothing
        // new provisioned to work.
        const demoInfo = { businessName: profile.businessName, greeting: profile.greeting, transferToNumber: process.env.RETELL_DEMO_PHONE_NUMBER };
        // FAQ has no key in WizardBlocks — it's the always-on baseline, so
        // building it with every optional block off leaves just greeting +
        // goodbye, which is exactly the FAQ-only demo we want.
        const { startNodeId, nodes } = block
          ? buildSingleBlockDemoFlow(demoInfo, block)
          : buildWizardFlow(demoInfo, { booking: false, transfer: false, takeMessage: false });

        const demoFlow = {
          id: 'demo',
          tenantId: 'demo',
          name: `Demo - ${profile.businessName}`,
          nodes,
          globalSettings: { allowInterruptions: true, returnToFlow: true, startNodeId },
          isActive: true,
          version: 1,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        };
        const prompt = flowToRetellPrompt(demoFlow);
        const generalTools = flowToRetellTools(demoFlow);

        // Create LLM with the capability-specific prompt (no separate
        // Retell knowledge base — the FAQ capability demos answering from
        // what's in the prompt itself, matching how a brand-new real
        // tenant's agent behaves before they've added their own KB content).
        console.log(`Creating LLM for ${profile.businessName}...`);
        const llm = await retell.createLLM({
          generalPrompt: prompt,
          beginMessage: profile.greeting,
          generalTools: generalTools.length > 0 ? generalTools : undefined,
        });

        // Create Agent with profile's voice
        console.log(`Creating Agent for ${profile.businessName}...`);
        const agent = await retell.createAgent({
          agentName: `Demo - ${profile.businessName}`,
          voiceId: profile.voiceId,
          llmId: llm.llm_id,
        });

        // Save to database
        const { error: insertError } = await supabase
          .from('calldesk_demo_agents')
          .insert({
            profile_id: profileId,
            business_name: profile.businessName,
            business_type: profile.businessType,
            retell_agent_id: agent.agent_id,
            retell_llm_id: llm.llm_id,
            voice_id: profile.voiceId,
            greeting: profile.greeting,
          });

        if (insertError) {
          throw insertError;
        }

        results.push({ profile: profileId, success: true });
        console.log(`Created demo agent for ${profile.businessName}`);
      } catch (err) {
        console.error(`Error creating demo agent for ${profileId}:`, err);
        results.push({
          profile: profileId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      message: 'Demo agents initialization complete',
      results,
    });
  } catch (error) {
    console.error('Error initializing demo agents:', error);
    return NextResponse.json(
      { error: 'Failed to initialize demo agents' },
      { status: 500 }
    );
  }
}

