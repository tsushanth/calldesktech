import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';

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
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, areaCode, voiceEngine } = body;

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
    // demo call, rather than only after a later Settings-page edit.
    if (voiceEngine === 'poc') {
      console.log('Creating poc-engine tenant (no Retell resources)...');
      const { data: tenant, error } = await supabase
        .from('calldesk_tenants')
        .insert({
          user_id: userId,
          name,
          settings: { voice_engine: 'poc' },
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
      return NextResponse.json({ tenant }, { status: 201 });
    }

    let llmId: string | null = null;
    let agentId: string | null = null;
    let phoneNumber: string | null = null;

    // Create Retell resources - this is required for the AI to work
    const retell = getRetellClient();

    // 1. Create LLM configuration in Retell
    console.log('Creating Retell LLM...');
    const llm = await retell.createLLM({
      generalPrompt: getDefaultPrompt(name),
      beginMessage: `Hello! Thank you for calling ${name}. How can I help you today?`,
    });
    llmId = llm.llm_id;
    console.log('LLM created:', llmId);

    // 2. Create Agent in Retell
    console.log('Creating Retell Agent...');
    const agent = await retell.createAgent({
      agentName: `${name} Receptionist`,
      voiceId: '11labs-Adrian',
      llmId: llm.llm_id,
    });
    agentId = agent.agent_id;
    console.log('Agent created:', agentId);

    // 3. Phone number handling
    // For demos, we don't purchase a number - we use a shared demo number configured in env
    // For production tenants, they would purchase their own number
    if (areaCode) {
      console.log('Purchasing phone number with area code:', areaCode);
      try {
        const phoneResult = await retell.purchasePhoneNumber(areaCode);
        phoneNumber = phoneResult.phone_number;
        await retell.assignPhoneNumberToAgent(phoneNumber, agent.agent_id);
        console.log('Phone number assigned:', phoneNumber);
      } catch (phoneError) {
        console.error('Failed to purchase phone number:', phoneError);
      }
    }

    // 4. Create tenant in database
    console.log('Creating tenant in Supabase...');
    const { data: tenant, error } = await supabase
      .from('calldesk_tenants')
      .insert({
        user_id: userId,
        name,
        phone_number: phoneNumber,
        retell_agent_id: agentId,
        retell_llm_id: llmId,
        settings: {
          voiceId: '11labs-Adrian',
          language: 'en-US',
          voice_engine: 'retell',
        },
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

    // 5. Create default conversation flow
    try {
      await supabase.from('calldesk_conversation_flows').insert({
        tenant_id: tenant.id,
        name: 'Default Flow',
        nodes: getDefaultFlowNodes(),
        global_settings: {
          allowInterruptions: true,
          returnToFlow: true,
        },
        is_active: true,
      });
    } catch (flowError) {
      console.error('Error creating default flow (non-fatal):', flowError);
    }

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

function getDefaultPrompt(businessName: string): string {
  return `
You are a friendly and professional AI receptionist for ${businessName}.

Your primary goals are:
1. Answer questions about the business
2. Help callers book appointments
3. Take messages for the team

Guidelines:
- Be warm, helpful, and concise
- If you don't know something, offer to have someone call them back
- Always confirm important details (name, phone number, appointment time)
- Handle interruptions naturally
- If asked about pricing or specific services, check the knowledge base

When booking appointments:
- Ask for the caller's name and preferred time
- Confirm the appointment details before ending the call
- If the requested time is unavailable, offer alternatives
`;
}

function getDefaultFlowNodes() {
  return [
    {
      id: 'greeting',
      type: 'greeting',
      prompt: 'Greet the caller warmly and ask how you can help them today.',
      edges: [
        { id: 'e1', condition: 'intent == "book_appointment"', target: 'collect_info' },
        { id: 'e2', condition: 'intent == "question"', target: 'answer_question' },
        { id: 'e3', condition: 'intent == "speak_to_human"', target: 'transfer' },
      ],
    },
    {
      id: 'collect_info',
      type: 'extraction',
      prompt: 'Ask for the caller\'s name and their preferred appointment time.',
      extract: { name: 'string', preferred_time: 'string' },
      edges: [
        { id: 'e4', condition: 'info_collected', target: 'confirm_booking' },
      ],
    },
    {
      id: 'answer_question',
      type: 'knowledge_base',
      prompt: 'Answer the caller\'s question using the knowledge base.',
      edges: [
        { id: 'e5', condition: 'answered', target: 'anything_else' },
        { id: 'e6', condition: 'unknown', target: 'take_message' },
      ],
    },
    {
      id: 'confirm_booking',
      type: 'function',
      prompt: 'Confirm the appointment details with the caller.',
      function: 'confirm_booking',
      edges: [
        { id: 'e7', condition: 'confirmed', target: 'goodbye' },
        { id: 'e8', condition: 'needs_change', target: 'collect_info' },
      ],
    },
    {
      id: 'anything_else',
      type: 'greeting',
      prompt: 'Ask if there\'s anything else you can help with.',
      edges: [
        { id: 'e9', condition: 'yes', target: 'greeting' },
        { id: 'e10', condition: 'no', target: 'goodbye' },
      ],
    },
    {
      id: 'take_message',
      type: 'extraction',
      prompt: 'Offer to take a message. Ask for their name and callback number.',
      extract: { name: 'string', phone: 'string', message: 'string' },
      edges: [
        { id: 'e11', condition: 'message_taken', target: 'goodbye' },
      ],
    },
    {
      id: 'transfer',
      type: 'transfer',
      prompt: 'Let them know you\'re transferring them to a team member.',
      edges: [],
    },
    {
      id: 'goodbye',
      type: 'goodbye',
      prompt: 'Thank them for calling and wish them a great day.',
      edges: [],
    },
  ];
}
