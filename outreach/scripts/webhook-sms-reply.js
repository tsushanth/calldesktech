#!/usr/bin/env node
/**
 * Webhook handler for inbound SMS replies to Group B text campaign
 * 
 * Deploy as: POST /api/webhooks/sms-reply
 * 
 * What it does:
 *   1. Receives Twilio inbound SMS webhook
 *   2. Classifies reply with Groq/Ollama (interested/not_interested/question/opt_out)
 *   3. Stores reply in outreach_text_campaign
 *   4. For warm replies, queues AI callback
 */

import { createHmac } from 'node:crypto';

function loadEnv() {
  const fs = await import('node:fs');
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

// --- Reply Classification ---
async function classifyReply(replyText) {
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

  // Try Groq first
  if (env.GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'authorization': `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          max_tokens: 10,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
        }),
      });
      const data = await res.json();
      const classification = data.choices?.[0]?.message?.content?.trim().toLowerCase();
      if (['interested', 'not_interested', 'question', 'opt_out', 'unclear'].includes(classification)) {
        return classification;
      }
    } catch (e) {
      console.error('Groq classification failed:', e.message);
    }
  }
  
  // Fallback: simple keyword matching
  const text = replyText.toLowerCase();
  if (/stop|unsubscribe|remove|don't text|no more/i.test(text)) return 'opt_out';
  if (/yes|interested|tell me|more info|sounds good|interested/i.test(text)) return 'interested';
  if (/no|not interested|don't call|wrong number/i.test(text)) return 'not_interested';
  if (/\?|how much|what is|how does/i.test(text)) return 'question';
  return 'unclear';
}

// --- Store Reply ---
async function storeReply(from, replyBody, classification) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return false;
  
  const phone = from.replace(/^\+1/, ''); // Normalize
  
  // Update the matching row
  const res = await fetch(`${supabaseUrl}/rest/v1/outreach_text_campaign?phone=eq.${phone}&status=eq.sent&order=sent_at.desc&limit=1`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      status: 'replied',
      reply_body: replyBody,
      reply_classified: classification,
      replied_at: new Date().toISOString(),
    }),
  });
  
  return res.ok;
}

// --- Trigger AI Callback ---
async function triggerAICallback(phone, companyName) {
  const callLoopUrl = env.CALL_LOOP_URL || 'https://call-loop-poc.fly.dev';
  const secret = env.TEST_CALL_SECRET;
  if (!secret) {
    console.error('TEST_CALL_SECRET missing, cannot trigger AI call');
    return null;
  }
  
  const res = await fetch(`${callLoopUrl}/place-test-call`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      toNumber: `+1${phone}`,
      shopper: false, // We're the business now, not the shopper
      record: true,
    }),
  });
  
  if (!res.ok) {
    console.error(`AI callback failed: ${await res.text()}`);
    return null;
  }
  
  const data = await res.json();
  return data.sid;
}

// --- Webhook Handler ---
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const body = await req.json();
    const from = body.From; // +15551234567
    const replyBody = body.Body;
    
    console.log(`[sms-reply] From: ${from}, Body: ${replyBody}`);
    
    // Classify
    const classification = await classifyReply(replyBody);
    console.log(`[sms-reply] Classified as: ${classification}`);
    
    // Store
    const stored = await storeReply(from, replyBody, classification);
    if (!stored) {
      console.warn('[sms-reply] Could not store reply — number may not be in campaign');
    }
    
    // Handle opt-out immediately
    if (classification === 'opt_out') {
      console.log(`[sms-reply] Opt-out received for ${from}`);
      // Could add to suppression list here
      return res.status(200).json({ action: 'opt_out_recorded' });
    }
    
    // For interested replies, trigger AI callback
    if (classification === 'interested' && stored) {
      const phone = from.replace(/^\+1/, '');
      console.log(`[sms-reply] Warm lead! Triggering AI callback to ${phone}`);
      const callSid = await triggerAICallback(phone);
      if (callSid) {
        console.log(`[sms-reply] AI call placed: ${callSid}`);
        return res.status(200).json({ action: 'ai_callback_triggered', callSid });
      }
    }
    
    res.status(200).json({ action: 'reply_recorded', classification });
  } catch (err) {
    console.error('[sms-reply] Error:', err);
    res.status(500).json({ error: err.message });
  }
}

// For testing locally
if (import.meta.url === `file://${process.argv[1]}`) {
  // Test classification
  const testReplies = [
    'Yes, tell me more',
    'How much does it cost?',
    'Stop texting me',
    'Not interested',
    'Who is this?',
    'Sounds good, call me tomorrow',
  ];
  
  console.log('Testing reply classification...\n');
  for (const reply of testReplies) {
    const classification = await classifyReply(reply);
    console.log(`"${reply}" -> ${classification}`);
  }
}
