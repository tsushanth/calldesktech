import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { DEMO_PROFILES, type DemoProfileId } from '@/lib/constants';

// GET /api/demo-agents - Get all demo agents
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data: agents, error } = await supabase
      .from('demo_agents')
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

// POST /api/demo-agents - Initialize demo agents (admin only, run once)
export async function POST(request: NextRequest) {
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
    for (const [profileId, profile] of Object.entries(DEMO_PROFILES) as [DemoProfileId, typeof DEMO_PROFILES[DemoProfileId]][]) {
      try {
        // Check if already exists
        const { data: existing } = await supabase
          .from('demo_agents')
          .select('id')
          .eq('profile_id', profileId)
          .single();

        if (existing) {
          results.push({ profile: profileId, success: true, error: 'Already exists' });
          continue;
        }

        // Create LLM with profile-specific prompt
        console.log(`Creating LLM for ${profile.businessName}...`);
        const llm = await retell.createLLM({
          generalPrompt: getDemoPrompt(profile),
          beginMessage: profile.greeting,
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
          .from('demo_agents')
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

// Generate a demo-specific prompt
function getDemoPrompt(profile: typeof DEMO_PROFILES[DemoProfileId]): string {
  const basePrompt = `You are a friendly and professional AI receptionist for ${profile.businessName}, a ${profile.businessType} business.

Your personality: ${profile.displayName} - ${profile.voiceStyle}

Your primary goals are:
1. Warmly greet callers and make them feel welcome
2. Answer questions about the business and services
3. Help callers book appointments
4. Take messages when needed

Guidelines:
- Be warm, helpful, and conversational
- Match your tone to the business type
- If you don't know something specific, offer to have someone call them back
- Always confirm important details (name, phone number, appointment time)
- Keep responses concise but friendly`;

  // Add business-specific context
  const businessContext = getBusinessContext(profile.businessType);

  return `${basePrompt}

${businessContext}

When booking appointments:
- Ask for the caller's name and preferred time
- Confirm the appointment details before ending the call
- If the requested time is unavailable, offer alternatives

Remember: This is a demo call, so be helpful and showcase the AI's capabilities!`;
}

function getBusinessContext(businessType: string): string {
  switch (businessType) {
    case 'plumbing':
      return `Business context:
- We handle emergency plumbing, water heaters, drain cleaning, and general repairs
- Emergency calls are prioritized
- We serve residential and commercial customers
- Typical appointment slots are morning (8-12) and afternoon (1-5)`;

    case 'salon':
      return `Business context:
- We offer haircuts, coloring, styling, and spa treatments
- Popular services include blowouts, highlights, and manicures
- Walk-ins are welcome but appointments are recommended
- We have experienced stylists for all hair types`;

    case 'medical':
      return `Business context:
- We're a family medical clinic offering primary care
- We handle routine checkups, sick visits, and preventive care
- New patients are welcome
- We accept most major insurance plans`;

    case 'restaurant':
      return `Business context:
- We serve authentic Italian cuisine
- Reservations are recommended for dinner, especially weekends
- We can accommodate dietary restrictions
- Private dining available for special events`;

    case 'auto_repair':
      return `Business context:
- We handle oil changes, brake service, engine diagnostics, and general repairs
- We work on all makes and models
- Free estimates are provided
- We offer a shuttle service for customers`;

    default:
      return `Business context:
- We're here to help with all your ${businessType} needs
- Appointments can be scheduled at your convenience`;
  }
}
