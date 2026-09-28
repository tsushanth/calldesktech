#!/usr/bin/env node
/**
 * Poll for inbound SMS replies and classify them
 *
 * Usage:
 *   node outreach/scripts/poll-sms-replies.js --interval 60
 *
 * What it does:
 *   1. Polls calldesk_sms_messages for inbound replies matching campaign numbers
 *   2. Classifies each reply with Groq (interested/not_interested/question/opt_out)
 *   3. Updates outreach_text_campaign with reply + classification
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

async function getSentCampaignNumbers() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/outreach_text_campaign?status=eq.sent&select=phone,company_name`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  return await res.json();
}

async function getUnprocessedReplies(phoneNumbers) {
  if (phoneNumbers.length === 0) return [];
  // Get all inbound SMS for these numbers that haven't been linked to outreach_text_campaign yet
  // We match by from_number and check if there's no corresponding reply in outreach_text_campaign
  const numbers = phoneNumbers.map(n => `'${n}'`).join(',');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/calldesk_sms_messages?direction=eq.inbound&from_number=in.(${numbers})&order=created_at.desc&limit=50`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) {
    console.error('Failed to fetch SMS:', await res.text());
    return [];
  }
  return await res.json();
}

async function classifyReply(replyText) {
  if (!replyText) return 'unclear';
  const prompt = `You are classifying SMS replies from business owners who received a cold text about an AI phone answering service.

Reply: "${replyText}"

Classify as ONE of: interested, not_interested, question, opt_out, unclear

Rules:
- "interested" = positive, wants to learn more, says yes, asks for info
- "not_interested" = explicitly says no, not interested, don't contact me
- "question" = asks a question but doesn't commit
- "opt_out" = says stop, unsubscribe, remove me
- "unclear" = ambiguous, non-committal, just "ok", "who is this"

Respond with ONLY the classification word, nothing else.`;

  if (GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'authorization': `Bearer ${GROQ_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant', max_tokens: 10,
          messages: [{ role: 'user', content: prompt }], temperature: 0,
        }),
      });
      const data = await res.json();
      const c = data.choices?.[0]?.message?.content?.trim().toLowerCase();
      if (['interested','not_interested','question','opt_out','unclear'].includes(c)) return c;
    } catch (e) {
      console.error('Groq classification failed:', e.message);
    }
  }

  // Fallback keyword matching
  const text = replyText.toLowerCase();
  if (/stop|unsubscribe|remove|don't text|no more/i.test(text)) return 'opt_out';
  if (/yes|interested|tell me|more info|sounds good/i.test(text)) return 'interested';
  if (/no|not interested|don't call|wrong number/i.test(text)) return 'not_interested';
  if (/\?|how much|what is|how does/i.test(text)) return 'question';
  return 'unclear';
}

async function updateCampaignReply(phone, replyBody, classification) {
  const normalizedPhone = String(phone).replace(/\D/g, '');

  // Find the most recent sent record for this phone
  const res = await fetch(`${SUPABASE_URL}/rest/v1/outreach_text_campaign?phone=eq.${normalizedPhone}&status=eq.sent&order=sent_at.desc&limit=1`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return false;

  const records = await res.json();
  if (records.length === 0) return false;

  const patch = await fetch(`${SUPABASE_URL}/rest/v1/outreach_text_campaign?id=eq.${records[0].id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      status: classification === 'opt_out' ? 'opted_out' : 'replied',
      reply_body: replyBody,
      reply_classified: classification,
      replied_at: new Date().toISOString(),
    }),
  });

  return patch.ok;
}

async function poll() {
  const campaigns = await getSentCampaignNumbers();
  const phones = [...new Set(campaigns.map(c => String(c.phone).replace(/\D/g, '')))];

  if (phones.length === 0) {
    console.log(`[${new Date().toISOString()}] No active campaign numbers`);
    return;
  }

  const replies = await getUnprocessedReplies(phones);
  if (replies.length === 0) {
    console.log(`[${new Date().toISOString()}] No new replies`);
    return;
  }

  console.log(`[${new Date().toISOString()}] Found ${replies.length} inbound SMS`);

  for (const reply of replies) {
    const from = String(reply.from_number).replace(/\D/g, '');
    console.log(`  ${from}: "${reply.body}"`);

    const classification = await classifyReply(reply.body);
    console.log(`    -> ${classification}`);

    const updated = await updateCampaignReply(from, reply.body, classification);
    if (updated) console.log(`    ✅ Tracked`);
    else console.warn(`    ⚠️ Could not update campaign record`);

    if (classification === 'opt_out') {
      console.log(`    🚫 Opt-out recorded`);
    }
  }
}

// --- Main ---
const intervalArg = process.argv.find(a => a.startsWith('--interval='));
const interval = parseInt(intervalArg?.split('=')[1] || '60', 10);

console.log(`Polling SMS replies every ${interval}s...`);
console.log(`Press Ctrl+C to stop\n`);

poll();
setInterval(poll, interval * 1000);
