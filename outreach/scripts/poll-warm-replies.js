#!/usr/bin/env node
/**
 * Poll for warm SMS replies and trigger AI callbacks
 * 
 * Usage:
 *   node outreach/scripts/poll-warm-replies.js [--interval 60]
 * 
 * Runs continuously, polling Supabase for 'interested' replies,
 * then triggers AI callback via call-loop-poc.
 * 
 * Part of Group B: Text-First Outreach
 */

function loadEnv() {
  const fs = require('fs');
  const envPath = `${process.env.HOME}/Documents/GitHub/realtime-tts/call-loop-poc/.env`;
  const env = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      if (line.includes('=') && !line.startsWith('#')) {
        const [k, ...v] = line.split('=');
        env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (v) env[k] = v;
  }
  return env;
}

const env = loadEnv();

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const CALL_LOOP_URL = env.CALL_LOOP_URL || 'https://call-loop-poc.fly.dev';
const TEST_CALL_SECRET = env.TEST_CALL_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Supabase credentials missing');
  process.exit(1);
}
if (!TEST_CALL_SECRET) {
  console.error('TEST_CALL_SECRET missing — cannot trigger AI calls');
  process.exit(1);
}

async function getWarmReplies() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/outreach_text_campaign?status=eq.replied&reply_classified=eq.interested&ai_call_sid=is.null&limit=10`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  
  if (!res.ok) {
    console.error(`Failed to fetch: ${await res.text()}`);
    return [];
  }
  
  return await res.json();
}

async function triggerAICallback(phone, companyName) {
  // The AI call should NOT be a shopper — it's a sales call from us
  // We need a different endpoint or modify the flow
  
  // For now, place a test call that goes to our agent
  const res = await fetch(`${CALL_LOOP_URL}/place-test-call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TEST_CALL_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      toNumber: phone.startsWith('+') ? phone : `+1${phone}`,
      shopper: false,
      record: true,
    }),
  });
  
  if (!res.ok) {
    console.error(`AI call failed: ${await res.text()}`);
    return null;
  }
  
  return await res.json();
}

async function updateCallSid(rowId, callSid) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/outreach_text_campaign?id=eq.${rowId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ ai_call_sid: callSid }),
  });
  
  return res.ok;
}

async function poll() {
  const leads = await getWarmReplies();
  
  if (leads.length === 0) {
    console.log(`[${new Date().toISOString()}] No warm replies waiting`);
    return;
  }
  
  console.log(`[${new Date().toISOString()}] Found ${leads.length} warm replies`);
  
  for (const lead of leads) {
    console.log(`  Calling ${lead.company_name} at ${lead.phone}...`);
    
    try {
      const result = await triggerAICallback(lead.phone, lead.company_name);
      if (result && result.sid) {
        await updateCallSid(lead.id, result.sid);
        console.log(`    ✅ Call placed: ${result.sid}`);
      }
    } catch (err) {
      console.error(`    ❌ Failed: ${err.message}`);
    }
    
    // Rate limit: wait between calls
    await new Promise(r => setTimeout(r, 5000));
  }
}

// --- Main ---
const interval = parseInt(process.argv.find(a => a.startsWith('--interval='))?.split('=')[1] || '60', 10);

console.log(`Polling warm replies every ${interval} seconds...`);
console.log(`Press Ctrl+C to stop\n`);

// Run immediately, then on interval
poll();
setInterval(poll, interval * 1000);
