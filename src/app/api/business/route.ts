import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
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

    // Create Retell LLM with business details
    console.log('Creating Retell LLM...');
    const llm = await retell.createLLM({
      generalPrompt: getBusinessPrompt(name, description, business_type),
      beginMessage: `Hello! Thank you for calling ${name}. How can I help you today?`,
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
      .from('tenants')
      .insert({
        user_id: session.user.id,
        name,
        retell_agent_id: agentId,
        retell_llm_id: llmId,
        settings: {
          voiceId: '11labs-Adrian',
          language: 'en-US',
          business_type,
          description,
          website,
          address,
          phone,
          hours,
          email: email || session.user.email,
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
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Get user's businesses (tenants)
    const { data: businesses, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('user_id', session.user.id)
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
