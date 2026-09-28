import { getSupabaseAdmin } from '@/lib/supabase';
import { getSmsProvider } from '@/lib/smsProvider';

const CALLDESK_API_KEY = process.env.CALLDESK_API_KEY;
const CALLDESK_BASE_URL = (process.env.CALLDESK_BASE_URL || 'https://calldesk.tech/api/v1').replace(/\/$/, '');

let tenantIdCache: string | null = null;

async function cdApi(method: string, path: string, body?: any) {
  const url = `${CALLDESK_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${CALLDESK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(`CD ${method} ${path} (${res.status}): ${data?.error || text}`);
  return data;
}

async function tenantId() {
  if (tenantIdCache) return tenantIdCache;
  const me = await cdApi('GET', '/me');
  if (!me.tenantId) throw new Error('API key not pinned to tenant');
  tenantIdCache = me.tenantId;
  return me.tenantId;
}

function buildFlow(companyName: string, greeting: string, transferNumber: string) {
  const g = greeting || `Hi, this is ${companyName}. How can I help you?`;
  const t = transferNumber || '';

  return {
    startNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        type: 'greeting',
        prompt: `Say: "${g}" Then ask: "I can take a message, or transfer you to a human if it's urgent. What do you need?"`,
        edges: [
          { id: 'e_urgent', condition: 'says urgent, needs human, wants transfer, or says operator', target: 'transfer' },
          { id: 'e_message', condition: 'anything else, wants to leave a message, or stays silent', target: 'collect_message' },
        ],
      },
      {
        id: 'collect_message',
        type: 'extraction',
        prompt: `Say: "No problem. What's your name, callback number, and what do you need?" Collect all three fields — ask for them one by one if the caller only gives partial info.`,
        extract: { name: 'string', phone: 'string', message: 'string' },
        edges: [
          { id: 'e_collected', condition: 'all fields collected', target: 'confirm_message' },
        ],
      },
      {
        id: 'confirm_message',
        type: 'greeting',
        prompt: `Say a natural variation of: "Thanks. I have your message and will pass it along. Have a great day."`,
        edges: [
          { id: 'e_end', condition: 'always', target: 'goodbye' },
        ],
      },
      {
        id: 'transfer',
        type: 'transfer',
        params: { transferTo: t, spokenMessage: 'Transferring you now. One moment please.' },
      },
      {
        id: 'goodbye',
        type: 'goodbye',
      },
    ],
  };
}

/**
 * Create a trial agent for a session.
 * Returns the assigned phone number or throws.
 */
export async function createTrialForSession(sessionId: string) {
  const supabase = getSupabaseAdmin();

  const { data: session, error } = await supabase
    .from('trial_sms_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (error || !session) throw new Error('Session not found');
  if (!session.company_name) throw new Error('company_name missing');

  const { company_name, greeting, transfer_number, timezone } = session;
  const tid = await tenantId();
  const agent = await cdApi('POST', `/tenants/${tid}/agents`, {
    name: `[Trial] ${company_name}`,
    mode: 'simple',
  });

  const flow = buildFlow(company_name, greeting, transfer_number);
  const version = await cdApi('POST', `/agents/${agent.id}/versions`, {
    flowName: `${company_name} Receptionist`,
    startNodeId: flow.startNodeId,
    nodes: flow.nodes,
    voiceEngine: 'poc',
    globalSettings: {
      timezone: timezone || 'America/New_York',
      allowInterruptions: true,
      transitionFlexibility: 'flexible',
      handbook: `You are the AI receptionist for ${company_name}. Be friendly, concise, and professional. If someone wants to leave a message, collect their name, phone number, and what they need. If they say it's urgent or want to transfer, immediately transfer to ${transfer_number}. Never make up policies or prices.`,
    },
    ttsBackend: 'kokoro',
  });

  const number = await cdApi('POST', `/tenants/${tid}/phone-numbers/purchase`, {
    inbound: 'true',
  });
  const assigned = number.number || number.phoneNumber;
  if (!assigned) throw new Error('Buy number response missing number');

  await cdApi('POST', `/phone-numbers/${number.id}/routing`, {
    direction: 'inbound',
    agentVersionId: version.id,
  });

  await supabase
    .from('trial_sms_sessions')
    .update({
      agent_id: agent.id,
      agent_version_id: version.id,
      phone_number_id: number.id,
      assigned_number: assigned,
      trial_live_at: new Date().toISOString(),
      step: 'completed',
    })
    .eq('id', sessionId);

  // Send completion SMS
  const provider = getSmsProvider();
  const from = process.env.TRIAL_ONBOARDING_NUMBER || '+12245061194';
  const to = session.from_phone.startsWith('+') ? session.from_phone : `+1${session.from_phone}`;
  await provider.send({
    from,
    to,
    body: `Done! Your AI is live at ${assigned}. Call it to test. Dashboard: https://calldesk.tech/trial/${sessionId}\n\nQuestions? Reply HELP.`,
  });

  return { assigned_number: assigned, agent_id: agent.id };
}
