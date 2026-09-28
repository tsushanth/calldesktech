#!/usr/bin/env node
/**
 * Group B: Text-First Outreach System
 * 
 * Usage:
 *   node outreach/scripts/group-b-text-first.js --csv /tmp/callable-leads.csv --from +12245061194 --limit 50
 * 
 * What it does:
 *   1. Reads leads from CSV
 *   2. Sends personalized text messages via Twilio
 *   3. Tracks who was texted in Supabase
 *   4. Polls for replies
 *   5. For warm replies, triggers AI call via call-loop-poc
 * 
 * Requires:
 *   - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN in env
 *   - GROQ_API_KEY for AI reply classification (or Ollama on Mac Mini)
 *   - Supabase credentials for tracking
 */

import fs from 'node:fs';
import { parse } from 'csv-parse/sync';

// Read env from call-loop-poc/.env
function loadEnv() {
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
  // Also check process.env
  for (const [k, v] of Object.entries(process.env)) {
    if (v) env[k] = v;
  }
  return env;
}

const env = loadEnv();

// --- CLI Args ---
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const csvPath = arg('csv') || '/tmp/callable-leads.csv';
const fromNumber = arg('from') || '+12245061194';
const limit = parseInt(arg('limit') || '50', 10);
const dryRun = process.argv.includes('--dry-run');
const testNumber = arg('test-number'); // Send all texts to this number (for testing)

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

// Parse CSV
const csvContent = fs.readFileSync(csvPath, 'utf8');
const records = parse(csvContent, { columns: true, skip_empty_lines: true });

// Filter to leads with phone numbers
const leads = records
  .filter(r => r.phone && r.phone.length >= 10)
  .slice(0, limit);

console.log(`Loaded ${leads.length} leads from ${csvPath}`);
console.log(`From number: ${fromNumber}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no texts sent)' : 'LIVE'}`);
if (testNumber) console.log(`TEST MODE: All texts go to ${testNumber}`);
console.log('');

// --- Message Templates ---
const TEMPLATES = [
  // Template A: Direct question
  (lead) => `Hi ${firstName(lead.company)}, quick question — does ${shortName(lead.company)} get missed calls after hours? We're helping ${verticalName(lead.type)} businesses answer those with AI. Worth a 2-min call? — Alex, Calldesk`,
  
  // Template B: Benefit-focused
  (lead) => `Hi ${firstName(lead.company)}, ${shortName(lead.company)} ever lose leads to voicemail after 5pm? We built an AI phone agent that answers 24/7 and books appointments. Interested in a quick demo? — Alex`,
  
  // Template C: Social proof
  (lead) => `Hi ${firstName(lead.company)}, we're helping ${locationPrefix(lead.location)} ${verticalName(lead.type)} agencies capture after-hours leads with AI voice agents. ${shortName(lead.company)} getting calls you miss? — Alex, Calldesk`,
];

// --- Helper Functions ---
function firstName(company) {
  // Extract first name from company or use generic
  const names = ['there', 'Team', 'Owner'];
  return names[Math.floor(Math.random() * names.length)];
}

function shortName(company) {
  // Shorten company name
  return company.replace(/, (LLC|INC|LLP|Corp|DBA.*)$/i, '').trim();
}

function verticalName(type) {
  const map = {
    'licensed insurance agency': 'insurance',
    'dental practice with an organisational NPI': 'dental',
    'home care agency': 'home care',
    'road freight haulage company': 'freight',
    'towing company (tow truck operator)': 'towing',
    'septic tank service / liquid waste hauling company': 'septic',
    'licensed contractor': 'contractor',
  };
  return map[type] || 'service';
}

function locationPrefix(location) {
  const city = location.split(',')[0];
  return city || 'local';
}

function pickTemplate(lead, index) {
  return TEMPLATES[index % TEMPLATES.length](lead);
}

// --- Twilio SMS ---
async function sendSMS(to, body) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO credentials missing');
  
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  
  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', fromNumber);
  params.append('Body', body);
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio error: ${err}`);
  }
  
  return await res.json();
}

// --- Supabase Tracking ---
async function trackText(lead, messageSid, body) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[warn] Supabase not configured, skipping tracking');
    return;
  }
  
  const payload = {
    lead_rank: parseInt(lead.rank),
    company_name: lead.company,
    phone: lead.phone,
    email: lead.email || null,
    location: lead.location,
    score: parseInt(lead.score),
    message_sid: messageSid,
    body: body,
    status: 'sent',
    sent_at: new Date().toISOString(),
  };
  
  const res = await fetch(`${supabaseUrl}/rest/v1/outreach_text_campaign`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  
  if (!res.ok) {
    console.error(`[warn] Failed to track: ${await res.text()}`);
  }
}

// --- Main Loop ---
async function main() {
  const results = [];
  
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const to = testNumber || `+1${lead.phone}`;
    const body = pickTemplate(lead, i);
    
    console.log(`[${i + 1}/${leads.length}] ${lead.company}`);
    console.log(`  To: ${to}`);
    console.log(`  Body: ${body}`);
    
    if (dryRun) {
      console.log(`  [DRY RUN] Would send text`);
      results.push({ lead, status: 'dry-run', body });
      continue;
    }
    
    try {
      const twilioRes = await sendSMS(to, body);
      console.log(`  ✅ Sent: ${twilioRes.sid}`);
      await trackText(lead, twilioRes.sid, body);
      results.push({ lead, status: 'sent', sid: twilioRes.sid, body });
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      results.push({ lead, status: 'failed', error: err.message, body });
    }
    
    // Rate limit: max 1 msg/sec for Twilio
    if (i < leads.length - 1) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }
  
  // Save results
  const resultsPath = `/tmp/group-b-results-${Date.now()}.json`;
  fs.writeFileSync(resultsPath, JSON.stringify({ sent: results.filter(r => r.status === 'sent').length, failed: results.filter(r => r.status === 'failed').length, total: results.length, results }, null, 2));
  console.log(`\nResults saved to: ${resultsPath}`);
  console.log(`Sent: ${results.filter(r => r.status === 'sent').length}`);
  console.log(`Failed: ${results.filter(r => r.status === 'failed').length}`);
  
  if (dryRun) {
    console.log('\n[DRY RUN] No texts were actually sent.');
    console.log('To send for real, remove --dry-run flag');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
