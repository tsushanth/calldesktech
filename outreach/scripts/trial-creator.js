#!/usr/bin/env node
/**
 * Trial Creator
 *
 * Usage:
 *   node outreach/scripts/trial-creator.js --session-id <uuid>
 *
 * Reads onboarding data from trial_sms_sessions,
 * then:
 *   1. Creates agent
 *   2. Publishes version with custom flow
 *   3. Buys phone number
 *   4. Routes number → agent version
 *   5. Updates session with resource IDs
 */

const CALLDESK_API_KEY = process.env.CALLDESK_API_KEY;
const CALLDESK_BASE_URL = (process.env.CALLDESK_BASE_URL || 'https://calldesk.tech/api/v1').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const sessionId = arg('session-id');
if (!sessionId) { console.error('--session-id required'); process.exit(1); }

// ------------------------------------------------------------------
// CallDeskTech API
// ------------------------------------------------------------------
async function cdApi(method, path, body) {
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

let tenantIdCache = null;
async function tenantId() {
  if (tenantIdCache) return tenantIdCache;
  const me = await cdApi('GET', '/me');
  if (!me.tenantId) throw new Error('API key not pinned to tenant');
  tenantIdCache = me.tenantId;
  return me.tenantId;
}

// ------------------------------------------------------------------
// Fetch / update session
// ------------------------------------------------------------------
async function fetchSession() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?id=eq.${sessionId}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error('Failed to fetch session');
  const rows = await res.json();
  if (!rows.length) throw new Error('Session not found');
  return rows[0];
}

async function updateSession(updates) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?id=eq.${sessionId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error('Failed to update session');
  return (await res.json())[0];
}

// ------------------------------------------------------------------
// Build agent flow
// ------------------------------------------------------------------
function buildFlow(companyName, greeting, transferNumber) {
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
      // transfer node — spokenMessage is played verbatim before transferring
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

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  const session = await fetchSession();
  console.log(`[trial-creator] Session ${session.id} step=${session.step}`);

  const { company_name, greeting, transfer_number, timezone } = session;
  if (!company_name) throw new Error('company_name missing');

  const tid = await tenantId();

  // 1. Create agent
  console.log(`[trial-creator] Creating agent: ${company_name}`);
  const agent = await cdApi('POST', `/tenants/${tid}/agents`, {
    name: `[Trial] ${company_name}`,
    mode: 'simple',
  });
  console.log(`  Agent: ${agent.id}`);

  // 2. Publish version
  const flow = buildFlow(company_name, greeting, transfer_number);
  console.log(`[trial-creator] Publishing version...`);
  const version = await cdApi('POST', `/agents/${agent.id}/versions`, {
    flowName: `${company_name} Receptionist`,
    startNodeId: flow.startNodeId,
    nodes: flow.nodes,
    voiceEngine: 'poc',
    globalSettings: {
      timezone: timezone || 'America/New_York',
      allowInterruptions: true,
      transitionFlexibility: 'flexible',
      handbook: `You are the AI receptionist for ${company_name}. Be friendly, concise, and professional. If someone wants to leave a message, collect their name, phone number, and what they need. If they say it's urgent or want to transfer, immediately transfer to ${transfer_number}. Never make up policies or prices. If asked about pricing, say a human agent from ${company_name} will follow up.`,
    },
    ttsBackend: 'kokoro',
  });
  console.log(`  Version: ${version.id}`);

  // 3. Buy number
  console.log(`[trial-creator] Buying number...`);
  const number = await cdApi('POST', `/tenants/${tid}/phone-numbers/purchase`, {
    inbound: 'true',
  });
  const assigned = number.number || number.phoneNumber;
  if (!assigned) throw new Error('Buy number response missing number');
  console.log(`  Number: ${assigned} (${number.id})`);

  // 4. Route inbound to agent version
  console.log(`[trial-creator] Routing inbound...`);
  await cdApi('POST', `/phone-numbers/${number.id}/routing`, {
    direction: 'inbound',
    agentVersionId: version.id,
  });
  console.log(`  Inbound routed.`);

  // 5. Update session
  await updateSession({
    agent_id: agent.id,
    agent_version_id: version.id,
    phone_number_id: number.id,
    assigned_number: assigned,
    trial_live_at: new Date().toISOString(),
    step: 'completed',
  });
  console.log(`[trial-creator] Done. ${assigned} is live for ${company_name}.`);
}

main().catch(err => {
  console.error(`[trial-creator] Fatal: ${err.message}`);
  process.exit(1);
});
