#!/usr/bin/env node
/**
 * Trial SMS Onboarding Engine
 *
 * Usage:
 *   export CALLDESK_API_KEY=cdk_live_...
 *   export SUPABASE_URL=https://...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   export TRIAL_FROM_NUMBER_ID=<uuid-your-cd-number>
 *   node outreach/scripts/trial-sms-onboarding.js --interval 30
 *
 * State machine (step → reply → next_step):
 *   greeting         → "Reply START"                  → company_name
 *   company_name     → "Business name?"               → greeting_prompt
 *   greeting_prompt  → "Custom greeting or 1 for default" → transfer_number
 *   transfer_number  → "Transfer number?"             → timezone
 *   timezone         → "Timezone?" → trial-creator    → completed
 *
 * Zero human touch after initial cold text.
 */

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------
const CALLDESK_API_KEY = process.env.CALLDESK_API_KEY;
const CALLDESK_BASE_URL = (process.env.CALLDESK_BASE_URL || 'https://calldesk.tech/api/v1').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TRIAL_FROM_NUMBER_ID = process.env.TRIAL_FROM_NUMBER_ID;

function die(msg) { console.error(msg); process.exit(1); }
if (!CALLDESK_API_KEY) die('CALLDESK_API_KEY required');
if (!SUPABASE_URL || !SUPABASE_KEY) die('Supabase credentials required');
if (!TRIAL_FROM_NUMBER_ID) die('TRIAL_FROM_NUMBER_ID required');

let tenantIdCache = null;

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
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
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

async function sendSMS(toNumber, body) {
  const tid = await tenantId();
  const to = String(toNumber).startsWith('+') ? toNumber : `+1${String(toNumber).replace(/\D/g, '')}`;
  return cdApi('POST', `/tenants/${tid}/sms`, { phoneNumberId: TRIAL_FROM_NUMBER_ID, toNumber: to, body });
}

// ------------------------------------------------------------------
// Supabase helpers
// ------------------------------------------------------------------
async function upsertSession(from, to) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?from_phone=eq.${from}&to_phone=eq.${to}&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error('Failed to fetch session');
  const rows = await res.json();
  if (rows.length) return rows[0];

  const create = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ from_phone: from, to_phone: to, step: 'greeting' }),
  });
  if (!create.ok) throw new Error('Failed to create session');
  return (await create.json())[0];
}

async function updateSession(id, updates) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?id=eq.${id}`, {
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
  const rows = await res.json();
  return rows[0];
}

async function fetchSession(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?id=eq.${id}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error('Failed to fetch session');
  const rows = await res.json();
  if (!rows.length) throw new Error('Session not found');
  return rows[0];
}

async function getProcessedSmsIds(trialNumber) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_messages?select=sms_message_id&order=processed_at.desc&limit=1000`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return new Set();
  const rows = await res.json();
  return new Set(rows.map(r => r.sms_message_id));
}

async function findUnprocessedMessages(trialNumber) {
  // Get all processed SMS IDs to exclude
  const processed = await getProcessedSmsIds(trialNumber);

  // Get all active sessions for this trial number
  const sessionsRes = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?to_phone=eq.${trialNumber}&step=neq.completed&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const sessions = sessionsRes.ok ? await sessionsRes.json() : [];

  // Get recent inbound SMS to this trial number
  const recentRes = await fetch(`${SUPABASE_URL}/rest/v1/calldesk_sms_messages?direction=eq.inbound&to_number=eq.${trialNumber}&order=created_at.desc&limit=50`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!recentRes.ok) return [];
  const msgs = await recentRes.json();

  const results = [];
  for (const msg of msgs) {
    if (processed.has(msg.id)) continue; // Skip already processed

    const from = msg.from_number;
    const session = sessions.find(s => s.from_phone === from) || await upsertSession(from, trialNumber);
    results.push({ session, message: msg });
  }

  return results;
}

async function markProcessed(sessionId, smsId, body, direction) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ session_id: sessionId, sms_message_id: smsId, body, direction }),
  });
  if (!res.ok) console.error(`[warn] markProcessed failed: ${await res.text()}`);
}

async function runTrialCreator(sessionId) {
  const { spawn } = await import('node:child_process');
  const script = `${process.env.HOME}/Documents/GitHub/calldesktech/outreach/scripts/trial-creator.js`;
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, '--session-id', sessionId], {
      cwd: process.cwd(),
      env: process.env,
    });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => {
      const combined = out + (err ? '\nSTDERR: ' + err : '');
      if (code !== 0) reject(new Error(combined.trim()));
      else resolve(combined.trim());
    });
  });
}

// ------------------------------------------------------------------
// State Machine
// ------------------------------------------------------------------

const REPLIES = {
  greeting: async (session, body) => {
    const text = body.toLowerCase().trim();
    if (/stop|unsubscribe|remove|don't text/i.test(text)) {
      await updateSession(session.id, { step: 'completed' });
      await sendSMS(session.from_phone, 'No problem. You will not receive any more messages.');
      return 'completed';
    }
    if (text.includes('help')) {
      await sendSMS(session.from_phone, 'Reply START to begin your free trial, or STOP to unsubscribe.');
      return 'greeting';
    }
    if (text.match(/^(start|yes|ok|sure|go)/i)) {
      await updateSession(session.id, { step: 'company_name' });
      await sendSMS(session.from_phone, "Great. What's your business name?");
      return 'company_name';
    }
    await sendSMS(session.from_phone, 'Ready to set up your AI receptionist in 2 mins? Reply START to begin.');
    return 'greeting';
  },

  company_name: async (session, body) => {
    const name = body.trim().slice(0, 60);
    if (name.length < 2) {
      await sendSMS(session.from_phone, 'Please send your business name again.');
      return 'company_name';
    }
    await updateSession(session.id, { company_name: name, step: 'greeting_prompt' });
    await sendSMS(session.from_phone, `Got it, ${name}. What should the AI say when it answers? Reply 1 for the default greeting, or type your own.`);
    return 'greeting_prompt';
  },

  greeting_prompt: async (session, body) => {
    let greeting = body.trim().slice(0, 200);
    if (greeting === '1') {
      greeting = `Hi, this is ${session.company_name}. How can I help you?`;
    }
    if (greeting.length < 5) {
      await sendSMS(session.from_phone, 'Please reply 1 for the default greeting, or type your own.');
      return 'greeting_prompt';
    }
    await updateSession(session.id, { greeting, step: 'transfer_number' });
    await sendSMS(session.from_phone, 'What number should urgent calls transfer to? Reply with a 10-digit number (e.g. 4155551234).');
    return 'transfer_number';
  },

  transfer_number: async (session, body) => {
    const digits = body.replace(/\D/g, '');
    const num = digits.length === 10 ? `+1${digits}`
      : digits.length === 11 && digits.startsWith('1') ? `+${digits}`
      : digits.length >= 12 ? `+${digits}`
      : null;
    if (!num) {
      await sendSMS(session.from_phone, 'Please send a valid 10-digit phone number.');
      return 'transfer_number';
    }
    await updateSession(session.id, { transfer_number: num, step: 'timezone' });
    await sendSMS(session.from_phone, 'What timezone? (e.g. America/New_York, America/Chicago, America/Los_Angeles)');
    return 'timezone';
  },

  timezone: async (session, body) => {
    const raw = body.trim();
    const tz = raw.replace(/\s/g, '_').replace(/"/g, '');
    const valid = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix'];
    if (!valid.includes(tz)) {
      await sendSMS(session.from_phone, `Please pick: ${valid.join(', ')}`);
      return 'timezone';
    }
    await updateSession(session.id, { timezone: tz });
    await sendSMS(session.from_phone, "Perfect. Creating your AI receptionist now... one sec.");

    try {
      console.log(`[trial-creator] Starting for session ${session.id}...`);
      const out = await runTrialCreator(session.id);
      console.log(`[trial-creator] Output: ${out}`);

      // Fetch fresh session to get assigned_number
      const fresh = await fetchSession(session.id);
      const num = fresh.assigned_number || 'your new number';
      const dash = `https://calldesk.tech/trial/${fresh.id}`;
      await sendSMS(fresh.from_phone, `Done! Your AI is live at ${num}. Call it to test. Dashboard: ${dash}\n\nQuestions? Reply HELP.`);
      await updateSession(fresh.id, { step: 'completed' });
      return 'completed';
    } catch (err) {
      console.error(`[trial-creator] Failed: ${err.message}`);
      await sendSMS(session.from_phone, "Oops, we hit a snag. Please reply your timezone again to retry.");
      return 'timezone';
    }
  },

  completed: async (session, body) => {
    const text = body.toLowerCase().trim();
    if (text.includes('help')) {
      await sendSMS(session.from_phone, `Dashboard: https://calldesk.tech/trial/${session.id}`);
    }
    return 'completed';
  },
};

// ------------------------------------------------------------------
// Main Loop
// ------------------------------------------------------------------
async function poll() {
  console.log(`[${new Date().toISOString()}] Polling...`);

  const numbers = await cdApi('GET', `/tenants/${await tenantId()}/phone-numbers`);
  const trialNum = numbers.find(n => n.id === TRIAL_FROM_NUMBER_ID);
  if (!trialNum) {
    console.error('TRIAL_FROM_NUMBER_ID not found');
    return;
  }
  const trialE164 = trialNum.number;

  const pairs = await findUnprocessedMessages(trialE164);
  if (!pairs.length) {
    console.log('  No new messages');
    return;
  }

  for (const { session, message } of pairs) {
    const body = message.body || '';
    console.log(`  ${session.from_phone}: "${body.substring(0,80)}" (step: ${session.step})`);

    const handler = REPLIES[session.step];
    if (!handler) {
      console.warn(`    Unknown step: ${session.step}`);
      continue;
    }

    // Mark processed BEFORE handling to avoid reprocessing on crash
    await markProcessed(session.id, message.id, body, 'inbound');

    try {
      const nextStep = await handler(session, body);
      console.log(`    -> ${nextStep}`);
    } catch (err) {
      console.error(`    Error in ${session.step}: ${err.message}`);
    }
  }
}

const intervalArg = process.argv.find(a => a.startsWith('--interval='));
const interval = parseInt(intervalArg?.split('=')[1] || '30', 10);

console.log('Trial SMS Onboarding Engine');
console.log(`  TRIAL_FROM_NUMBER_ID = ${TRIAL_FROM_NUMBER_ID}`);
console.log(`Polling every ${interval}s... Press Ctrl+C to stop\n`);

poll();
setInterval(poll, interval * 1000);
