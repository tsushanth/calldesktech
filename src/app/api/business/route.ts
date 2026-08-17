import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';
import { getMobileUser } from '@/lib/mobile-auth';

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

    const supabase = getSupabaseAdmin();
    const retell = getRetellClient();

    // Create knowledge base from website if provided
    let knowledgeBaseId: string | null = null;
    if (website) {
      try {
        console.log('Creating knowledge base from website:', website);
        const kb = await retell.createKnowledgeBase({
          name: `${name} Website`,
          urls: [website],
        });
        knowledgeBaseId = kb.knowledge_base_id;
        console.log('Knowledge base created:', knowledgeBaseId);
      } catch (kbError) {
        // Don't fail if KB creation fails, just log it
        console.error('Failed to create knowledge base:', kbError);
      }
    }

    // Create Retell LLM with business details and knowledge base
    console.log('Creating Retell LLM...');
    const llm = await retell.createLLM({
      generalPrompt: getBusinessPrompt(name, description, business_type),
      beginMessage: `Hello! Thank you for calling ${name}. How can I help you today?`,
      knowledgeBaseIds: knowledgeBaseId ? [knowledgeBaseId] : undefined,
    });
    const llmId = llm.llm_id;
    console.log('LLM created:', llmId);

    // Create Retell Agent
    console.log('Creating Retell Agent...');
    const agent = await retell.createAgent({
      agentName: `${name} Receptionist`,
      voiceId: '11labs-Adrian',
      llmId: llm.llm_id,
    });
    const agentId = agent.agent_id;
    console.log('Agent created:', agentId);

    // Create tenant (business) in database using the existing tenants table
    console.log('Creating tenant in Supabase...');
    const { data: tenant, error: createError } = await supabase
      .from('calldesk_tenants')
      .insert({
        user_id: userId,
        name,
        retell_agent_id: agentId,
        retell_llm_id: llmId,
        knowledge_base_id: knowledgeBaseId,
        settings: {
          voiceId: '11labs-Adrian',
          language: 'en-US',
          business_type,
          description,
          website,
          address,
          phone,
          hours,
          email: email || userEmail,
        },
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating business:', createError);
      return NextResponse.json(
        { error: `Failed to create business: ${createError.message}` },
        { status: 500 }
      );
    }

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

function getBusinessPrompt(name: string, description?: string, businessType?: string): string {
  let prompt = `
You are a friendly and professional AI receptionist for ${name}.

Your primary goals are:
1. Answer questions about the business
2. Help callers book appointments
3. Take messages for the team

Guidelines:
- Be warm, helpful, and concise
- If you don't know something, offer to have someone call them back
- Always confirm important details (name, phone number, appointment time)
- Handle interruptions naturally
`;

  if (businessType) {
    prompt += `\nBusiness type: ${businessType}\n`;
  }

  if (description) {
    prompt += `\nServices offered: ${description}\n`;
  }

  prompt += `
When booking appointments:
- Ask for the caller's name and preferred time
- Confirm the appointment details before ending the call
- If the requested time is unavailable, offer alternatives
`;

  return prompt;
}
