import { getSupabaseAdmin } from '@/lib/supabase';
import { getRetellClient } from '@/lib/retell';

// Shared by /api/business (real account onboarding) and /api/tenants' non-poc
// branch (currently only reachable from the demo flow) — both used to
// duplicate this same KB/LLM/Agent/tenant-row sequence and had drifted
// (only one of them created a default conversation flow, only one collected
// full business metadata). One implementation now; callers pass what they
// have and get back whichever tenant fields their own drifted version used
// to set, kept as optional inputs rather than removed.
//
// voiceEngine defaults to 'poc' (2026-09-17): this used to unconditionally
// provision real Retell LLM/Agent resources and hardcode
// settings.voice_engine: 'retell' for EVERY tenant created through the real
// "sign up as a new business" onboarding flow (/api/business) — meaning
// every real customer silently landed on Retell, the comparison baseline
// we benchmark against, rather than call-loop-poc, the actual product.
// 'retell' is now opt-in, for internal benchmarking tenants only.
export interface CreateBusinessTenantParams {
  userId: string;
  name: string;
  email?: string;
  businessType?: string;
  description?: string;
  website?: string;
  address?: string;
  phone?: string;
  hours?: string;
  voiceEngine?: 'poc' | 'retell';
}

export interface CreateBusinessTenantResult {
  tenant: { id: string; name: string };
  agentId: string | null;
  llmId: string | null;
  knowledgeBaseId: string | null;
}

export async function createBusinessTenant(
  params: CreateBusinessTenantParams
): Promise<CreateBusinessTenantResult> {
  const { userId, name, email, businessType, description, website, address, phone, hours } = params;
  const voiceEngine = params.voiceEngine === 'retell' ? 'retell' : 'poc';
  const supabase = getSupabaseAdmin();

  let knowledgeBaseId: string | null = null;
  let agentId: string | null = null;
  let llmId: string | null = null;

  if (voiceEngine === 'retell') {
    const retell = getRetellClient();
    if (website) {
      try {
        const kb = await retell.createKnowledgeBase({ name: `${name} Website`, urls: [website] });
        knowledgeBaseId = kb.knowledge_base_id;
      } catch (kbError) {
        console.error('Failed to create knowledge base:', kbError);
      }
    }

    const llm = await retell.createLLM({
      generalPrompt: getDefaultBusinessPrompt(name, description, businessType),
      beginMessage: `Hello! Thank you for calling ${name}. How can I help you today?`,
      knowledgeBaseIds: knowledgeBaseId ? [knowledgeBaseId] : undefined,
    });
    llmId = llm.llm_id;

    const agent = await retell.createAgent({
      agentName: `${name} Receptionist`,
      voiceId: '11labs-Adrian',
      llmId: llm.llm_id,
    });
    agentId = agent.agent_id;
  }

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
        voice_engine: voiceEngine,
        business_type: businessType,
        description,
        website,
        address,
        phone,
        hours,
        email,
      },
    })
    .select()
    .single();

  if (createError) {
    throw new Error(`Failed to create business: ${createError.message}`);
  }

  try {
    await supabase.from('calldesk_conversation_flows').insert({
      tenant_id: tenant.id,
      name: 'Default Flow',
      nodes: getDefaultFlowNodes(),
      global_settings: { allowInterruptions: true, returnToFlow: true },
      is_active: true,
    });
  } catch (flowError) {
    console.error('Error creating default flow (non-fatal):', flowError);
  }

  await attachExistingAccountBilling(tenant.id, userId);

  return {
    tenant: { id: tenant.id, name: tenant.name },
    agentId,
    llmId,
    knowledgeBaseId,
  };
}

// Account-level billing (2026-09-17): if this user already has an active
// subscription on ANY of their other workspaces, attach it to a NEW one
// immediately — matches Retell's own model, where adding a workspace never
// re-asks for payment info once the account has billing. A user with no
// existing subscription gets no calldesk_businesses row here, same as
// before; their first checkout still creates one normally (see the Stripe
// webhook), which now ALSO backfills this same inheritance onto any
// workspaces created before that first checkout. Called from every tenant-
// creation path, not just this one — see /api/tenants/route.ts's poc-engine
// branch (the actual "Add another workspace" path), which never runs
// createBusinessTenant at all.
export async function attachExistingAccountBilling(tenantId: string, userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  try {
    const { data: billedUser } = await supabase
      .from('calldesk_users')
      .select('stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', userId)
      .single();
    if (billedUser?.stripe_customer_id && billedUser.subscription_status === 'active') {
      await supabase.from('calldesk_businesses').insert({
        tenant_id: tenantId,
        subscription_status: 'active',
        stripe_customer_id: billedUser.stripe_customer_id,
        stripe_subscription_id: billedUser.stripe_subscription_id,
      });
    }
  } catch (billingError) {
    console.error('Error inheriting account billing for new tenant (non-fatal):', billingError);
  }
}

function getDefaultBusinessPrompt(name: string, description?: string, businessType?: string): string {
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

  if (businessType) prompt += `\nBusiness type: ${businessType}\n`;
  if (description) prompt += `\nServices offered: ${description}\n`;

  prompt += `
When booking appointments:
- Ask for the caller's name and preferred time
- Confirm the appointment details before ending the call
- If the requested time is unavailable, offer alternatives
`;

  return prompt;
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
      prompt: "Ask for the caller's name and their preferred appointment time.",
      extract: { name: 'string', preferred_time: 'string' },
      edges: [{ id: 'e4', condition: 'info_collected', target: 'confirm_booking' }],
    },
    {
      id: 'answer_question',
      type: 'knowledge_base',
      prompt: "Answer the caller's question using the knowledge base.",
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
      prompt: "Ask if there's anything else you can help with.",
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
      edges: [{ id: 'e11', condition: 'message_taken', target: 'goodbye' }],
    },
    {
      id: 'transfer',
      type: 'transfer',
      prompt: "Let them know you're transferring them to a team member.",
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
