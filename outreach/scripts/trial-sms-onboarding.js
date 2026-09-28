#!/usr/bin/env node
/**
 * Trial SMS Onboarding Engine
 *
 * Usage:
 *   export CALLDESK_API_KEY=...
 *   export SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   export TRIAL_FROM_NUMBER_ID=<uuid-your-cd-number>
 *   node outreach/scripts/trial-sms-onboarding.js --interval 30
 *
 * State machine (step → next_step on valid reply):
 *   greeting  → "Reply START"
 *   company_name → "What's your business name?"
 *   greeting_text → "What should the AI say when answering?"
 *   transfer_number → "What number for urgent transfers?"
 *   timezone → "What timezone?"
 *   creating → spins up trial via trial-creator.js
 *   live → "Done! Your AI is live at {{number}}"
 *   completed
 *
 * This script only SENDS and RECEIVES SMS. It does NOT create voice calls.
 */

import fs from 'node:fs';
import { parse } from 'csv-parse/sync';

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
  // Try to fetch existing
  const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?from_phone=eq.${from}&to_phone=eq.${to}&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error('Failed to fetch session');
  const rows = await res.json();
  if (rows.length) return rows[0];

  // Create new
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
  const created = await create.json();
  return created[0];
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

async function findUnprocessedMessages(trialNumber) {
  // Get latest session update timestamps per from_phone
  const sessionsRes = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?to_phone=eq.${trialNumber}&select=from_phone,id,step,updated_at`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!sessionsRes.ok) return [];
  const sessions = await sessionsRes.json();

  // For each session, fetch calldesk_sms_messages newer than updated_at
  const results = [];
  for (const s of sessions) {
    if (s.step === 'completed' || s.step === 'creating') continue;
    const after = s.updated_at;
    const url = `${SUPABASE_URL}/rest/v1/calldesk_sms_messages?direction=eq.inbound&from_number=eq.${s.from_phone}&to_number=eq.${trialNumber}&created_at=gte.${encodeURIComponent(after)}&order=created_at.desc&limit=1`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!res.ok) continue;
    const msgs = await res.json();
    if (msgs.length) {
      results.push({ session: s, message: msgs[0] });
    }
  }

  // Also check for entirely new numbers (no session yet)
  const allRecent = await fetch(`${SUPABASE_URL}/rest/v1/calldesk_sms_messages?direction=eq.inbound&to_number=eq.${trialNumber}&order=created_at.desc&limit=50`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (allRecent.ok) {
    const msgs = await allRecent.json();
    for (const msg of msgs) {
      const from = msg.from_number;
      if (!results.some(r => r.session.from_phone === from)) {
        const session = await upsertSession(from, trialNumber);
        results.push({ session, message: msg });
      }
    }
  }

  return results;
}

async function markProcessed(sessionId, smsId, body, direction) {
  await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ session_id: sessionId, sms_message_id: smsId, body, direction }),
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
      return 'greeting'; // stay
    }
    if (text.match(/^(start|yes|ok|sure|go)/i)) {
      await sendSMS(session.from_phone, "Great. What's your business name?");
      return 'company_name';
    }
    // Default: re-prompt
    await sendSMS(session.from_phone, 'Ready to set up your AI receptionist in 2 mins? Reply START to begin.');
    return 'greeting';
  },

  company_name: async (session, body) => {
    const name = body.trim().slice(0, 60);
    if (name.length < 2) {
      await sendSMS(session.from_phone, 'Please send your business name again.');
      return 'company_name';
    }
    await updateSession(session.id, { company_name: name });
    await sendSMS(session.from_phone, `Got it, ${name}. What should the AI say when it answers? Reply: 1) "Hi, this is ${name}. How can I help?" or type your own greeting.`);
    return 'greeting_text';
  },

  greeting_text: async (session, body) => {
    let greeting = body.trim().slice(0, 200);
    if (greeting === '1') {
      greeting = `Hi, this is ${session.company_name}. How can I help you?`;
    }
    if (greeting.length < 5) {
      await sendSMS(session.from_phone, 'Please type a greeting or reply 1 for the default.');
      return 'greeting_text';
    }
    await updateSession(session.id, { greeting_text: greeting });
    await sendSMS(session.from_phone, 'What number should urgent calls transfer to? (format: +14155551234 or 4155551234)');
    return 'transfer_number';
  },

  transfer_number: async (session, body) => {
    const digits = body.replace(/\D/g, '');
    const num = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : digits.length >= 12 ? `+${digits}` : null;
    if (!num) {
      await sendSMS(session.from_phone, 'Please send a valid 10-digit phone number.');
      return 'transfer_number';
    }
    await updateSession(session.id, { transfer_number: num });
    await sendSMS(session.from_phone, 'What timezone? (e.g. America/New_York, America/Chicago, America/Los_Angeles)');
    return 'timezone';
  },

  timezone: async (session, body) => {
    const tz = body.trim().replace(/\s/g, '_');
    const valid = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix'];
    if (!valid.includes(tz)) {
      await sendSMS(session.from_phone, `Please pick: ${valid.join(', ')}`);
      return 'timezone';
    }
    const s = await updateSession(session.id, { timezone: tz, step: 'creating' });
    await sendSMS(session.from_phone, "Perfect. Creating your AI receptionist now... one sec.");
    // Trigger trial creation
    try {
      const { spawn } = await import('node:child_process');
      const result = await new Promise((resolve, reject) => {
        const child = spawn('node', [
          `${process.env.HOME}/Documents/GitHub/calldesktech/outreach/scripts/trial-creator.js`,
          '--session-id', s.id,
        ], { cwd: process.cwd(), env: process.env });
        let out = '';
        child.stdout.on('data', d => out += d.toString());
        child.stderr.on('data', d => out += d.toString());
        child.on('close', code => {
          if (code !== 0) reject(new Error(out));
          else resolve(out);
        });
      });
      console.log(`[trial-creator] ${result}`);
    } catch (err) {
      console.error(`[trial-creator] failed: ${err.message}`);
      await sendSMS(session.from_phone, "Almost done! We're finalizing your setup and will text you the number in just a minute.");
      return 'creating'; // retry on next poll
    }
    return 'live';
  },

  live: async (session, body) => {
    // Fetch the session again to get assigned_number
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trial_sms_sessions?id=eq.${session.id}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await res.json();
    const fresh = rows[0];
    const number = fresh.assigned_number || 'your new number';
    const dashboard = `https://calldesk.tech/trial/${fresh.id}`;
    await sendSMS(session.from_phone, `Done! Your AI is live at ${number}. Call it to test. Dashboard: ${dashboard}\n\nQuestions? Reply HELP.`);
    await updateSession(session.id, { step: 'completed' });
    return 'completed';
  },

  completed: async (session, body) => {
    // After completed, minimal support
    const text = body.toLowerCase().trim();
    if (text.includes('help')) {
      await sendSMS(session.from_phone, 'Dashboard: https://calldesk.tech/trial/' + session.id);
    }
    return 'completed';
  },
};

// ------------------------------------------------------------------
// Main Loop
// ------------------------------------------------------------------
async function poll() {
  console.log(`[${new Date().toISOString()}] Polling...`);

  // Get the trial number from the environment
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
    console.log(`  ${session.from_phone}: "${body}" (step: ${session.step})`);

    // Mark processed BEFORE handling to avoid reprocessing on crash
    await markProcessed(session.id, message.id, body, 'inbound');

    const handler = REPLIES[session.step];
    if (!handler) {
      console.warn(`    Unknown step: ${session.step}`);
      continue;
    }

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
console.log(`Polling every ${interval}s... Press Ctrl+C to stop\n`);

poll();
setInterval(poll, interval * 1000);
