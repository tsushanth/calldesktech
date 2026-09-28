#!/usr/bin/env node
/**
 * Group B: Text-First Outreach (Twilio + Groq)
 *
 * Usage:
 *   node outreach/scripts/group-b-text-first.js --csv /tmp/callable-leads.csv --limit 50 --dry-run
 *
 * What it does:
 *   1. Reads leads from CSV
 *   2. Sends personalized texts via Twilio
 *   3. Tracks in Supabase outreach_text_campaign table
 *   4. Replies classified by Groq (cheap: $0.0002/req)
 *
 * Requires env vars:
 *   - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import fs from 'node:fs';
import { parse } from 'csv-parse/sync';

// Read env
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
const fromNumber = arg('from') || '+12245061194'; // Calldesk number
const limit = parseInt(arg('limit') || '50', 10);
const dryRun = process.argv.includes('--dry-run');
const testNumber = arg('test-number');

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

const csvContent = fs.readFileSync(csvPath, 'utf8');
const records = parse(csvContent, { columns: true, skip_empty_lines: true });

const leads = records
  .filter(r => r.phone && String(r.phone).replace(/\D/g, '').length >= 10)
  .slice(0, limit);

console.log(`=== Group B: Text-First Outreach ===`);
console.log(`Leads loaded: ${leads.length} from ${csvPath}`);
console.log(`From number: ${fromNumber}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no texts sent)' : 'LIVE'}`);
if (testNumber) console.log(`TEST: All texts go to ${testNumber}`);
console.log(`Tracking: Supabase outreach_text_campaign`);
console.log(`Reply classify: Groq (llama-3.1-8b)`);
console.log('');

// --- Templates ---
const TEMPLATES = [
  (lead) => `Hi ${firstName(lead.company)}, quick question — does ${shortName(lead.company)} get missed calls after hours? We're helping ${verticalName(lead.type)} businesses answer those with AI. Worth a 2-min call? — Alex, Calldesk`,
  (lead) => `Hi ${firstName(lead.company)}, does ${shortName(lead.company)} ever lose leads to voicemail after 5pm? We built an AI phone agent that answers 24/7 and books appointments. Interested in a quick demo? — Alex`,
  (lead) => `Hi ${firstName(lead.company)}, we're helping ${locationPrefix(lead.location)} ${verticalName(lead.type)} agencies capture after-hours leads with AI voice agents. ${shortName(lead.company)} getting calls you miss? — Alex, Calldesk`,
];

function firstName(company) {
  const names = ['there', 'Team', 'Owner'];
  return names[Math.floor(Math.random() * names.length)];
}

function shortName(company) {
  return String(company).replace(/, (LLC|INC|LLP|Corp|DBA.*)$/i, '').trim();
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
  const city = String(location || '').split(',')[0];
  return city || 'local';
}

function pickTemplate(lead, index) {
  return TEMPLATES[index % TEMPLATES.length](lead);
}

// --- Send via Twilio ---
async function sendSMS(to, body) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing');

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
    throw new Error(`Twilio ${res.status}: ${err}`);
  }

  return await res.json();
}

// --- Track in Supabase ---
async function trackText(lead, messageSid, body) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn('  [warn] Supabase not configured, skipping tracking');
    return;
  }

  const payload = {
    lead_rank: parseInt(lead.rank) || null,
    company_name: lead.company || lead.company_name,
    phone: String(lead.phone).replace(/\D/g, ''),
    email: lead.email || null,
    location: lead.location,
    score: parseInt(lead.score) || null,
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

  if (!res.ok) console.warn(`  [warn] Track failed: ${await res.text()}`);
}

// --- Main ---
async function main() {
  const results = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const rawPhone = String(lead.phone).replace(/\D/g, '');
    const to = testNumber || `+1${rawPhone}`;
    const body = pickTemplate(lead, i);

    console.log(`[${i + 1}/${leads.length}] ${lead.company || lead.company_name}`);
    console.log(`  To: ${to}`);
    console.log(`  Body: ${body}`);

    if (dryRun) {
      console.log(`  [DRY RUN] Text prepared`);
      results.push({ lead: lead.company || lead.company_name, status: 'dry-run', body });
      console.log('');
      continue;
    }

    try {
      const twilioRes = await sendSMS(to, body);
      console.log(`  ✅ Sent: ${twilioRes.sid}`);
      await trackText(lead, twilioRes.sid, body);
      results.push({ lead: lead.company || lead.company_name, status: 'sent', sid: twilioRes.sid, body });
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      results.push({ lead: lead.company || lead.company_name, status: 'failed', error: err.message, body });
    }

    if (i < leads.length - 1) await new Promise(r => setTimeout(r, 1100));
    console.log('');
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const dry = results.filter(r => r.status === 'dry-run').length;

  console.log('=== SUMMARY ===');
  console.log(`Total: ${results.length}`);
  if (sent) console.log(`Sent: ${sent}`);
  if (failed) console.log(`Failed: ${failed}`);
  if (dry) console.log(`Dry-run: ${dry}`);

  if (dry) {
    console.log('\n[Dry run] Remove --dry-run to send live texts');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
