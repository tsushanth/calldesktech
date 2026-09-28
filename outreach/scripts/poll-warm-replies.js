#!/usr/bin/env node
/**
 * Poll for warm SMS replies and trigger AI callbacks
 *
 * Usage:
 *   node outreach/scripts/poll-warm-replies.js --interval 60
 *
 * Runs continuously, polling Supabase for 'interested' replies
 * that haven't had an AI callback yet, then triggers AI sales call.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALL_LOOP_URL = process.env.CALL_LOOP_URL || 'https://call-loop-poc.fly.dev';
const TEST_CALL_SECRET = process.env.TEST_CALL_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}
if (!TEST_CALL_SECRET) {
  console.error('TEST_CALL_SECRET required for AI callbacks');
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
    console.error('Failed to fetch:', await res.text());
    return [];
  }

  return await res.json();
}

async function triggerAICallback(phone, companyName) {
  const toNumber = phone.startsWith('+') ? phone : `+1${String(phone).replace(/\D/g, '')}`;

  const res = await fetch(`${CALL_LOOP_URL}/place-test-call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TEST_CALL_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      toNumber,
      shopper: false,
      record: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI call failed (${res.status}): ${text}`);
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
      if (result?.sid) {
        await updateCallSid(lead.id, result.sid);
        console.log(`    ✅ Call placed: ${result.sid}`);
      } else {
        console.warn(`    ⚠️ No call SID returned`);
      }
    } catch (err) {
      console.error(`    ❌ Failed: ${err.message}`);
    }

    // Rate limit: wait between calls
    await new Promise(r => setTimeout(r, 5000));
  }
}

// --- Main ---
const intervalArg = process.argv.find(a => a.startsWith('--interval='));
const interval = parseInt(intervalArg?.split('=')[1] || '60', 10);

console.log(`Polling warm replies every ${interval}s...`);
console.log(`Call loop: ${CALL_LOOP_URL}`);
console.log(`Press Ctrl+C to stop\n`);

poll();
setInterval(poll, interval * 1000);
