#!/usr/bin/env node
/**
 * Group B: Text-First Outreach System
 *
 * Usage:
 *   node outreach/scripts/group-b-text-first.js \
 *     --csv /tmp/callable-leads.csv \
 *     --phone-number-id <uuid> \
 *     --limit 50
 *
 * What it does:
 *   1. Reads leads from CSV
 *   2. Sends personalized texts via CallDeskTech API (routes through Telnyx)
 *   3. Tracks who was texted in Supabase outreach_text_campaign
 *   4. For warm replies, poll-warm-replies.js triggers AI callback
 *
 * Requires:
 *   - CALLDESK_API_KEY in env
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for tracking
 */

import fs from 'node:fs';
import { parse } from 'csv-parse/sync';

const BASE = (process.env.CALLDESK_BASE_URL || 'https://calldesk.tech/api/v1').replace(/\/$/, '');

// --- CLI Args ---
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const csvPath = arg('csv') || '/tmp/callable-leads.csv';
const phoneNumberId = arg('phone-number-id');
const limit = parseInt(arg('limit') || '50', 10);
const dryRun = process.argv.includes('--dry-run');
const testNumber = arg('test-number'); // Send all texts to this number (for testing)

if (!phoneNumberId) {
  console.error('--phone-number-id is required (CallDeskTech phone number UUID)');
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

// Parse CSV
const csvContent = fs.readFileSync(csvPath, 'utf8');
const records = parse(csvContent, { columns: true, skip_empty_lines: true });

// Filter to leads with phone numbers
const leads = records
  .filter(r => r.phone && String(r.phone).replace(/\D/g, '').length >= 10)
  .slice(0, limit);

console.log(`Loaded ${leads.length} leads from ${csvPath}`);
console.log(`Phone number ID: ${phoneNumberId}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no texts sent)' : 'LIVE'}`);
if (testNumber) console.log(`TEST MODE: All texts go to ${testNumber}`);
console.log('');

// --- Message Templates ---
const TEMPLATES = [
  (lead) => `Hi ${firstName(lead.company)}, quick question — does ${shortName(lead.company)} get missed calls after hours? We're helping ${verticalName(lead.type)} businesses answer those with AI. Worth a 2-min call? — Alex, Calldesk`,
  (lead) => `Hi ${firstName(lead.company)}, ${shortName(lead.company)} ever lose leads to voicemail after 5pm? We built an AI phone agent that answers 24/7 and books appointments. Interested in a quick demo? — Alex`,
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
  const city = String(location).split(',')[0];
  return city || 'local';
}

function pickTemplate(lead, index) {
  return TEMPLATES[index % TEMPLATES.length](lead);
}

// --- CallDeskTech API ---
async function api(method, path, body) {
  const apiKey = process.env.CALLDESK_API_KEY;
  if (!apiKey) throw new Error('CALLDESK_API_KEY not set');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`CallDeskTech ${method} ${path} failed (${res.status}): ${data?.error || text}`);
  return data;
}

async function sendSMS(toNumber, body) {
  // Resolve tenant from API key
  const me = await api('GET', '/me');
  if (!me.tenantId) throw new Error('API key not pinned to a workspace');

  return api('POST', `/tenants/${me.tenantId}/sms`, {
    phoneNumberId,
    toNumber: toNumber.startsWith('+') ? toNumber : `+1${toNumber.replace(/\D/g, '')}`,
    body,
  });
}

// --- Supabase Tracking ---
async function trackText(lead, messageId, body) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[warn] Supabase not configured, skipping tracking');
    return;
  }

  const payload = {
    lead_rank: parseInt(lead.rank) || null,
    company_name: lead.company,
    phone: String(lead.phone).replace(/\D/g, ''),
    email: lead.email || null,
    location: lead.location,
    score: parseInt(lead.score) || null,
    message_sid: messageId, // CallDeskTech sms.id
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

  if (!res.ok) console.error(`[warn] Failed to track: ${await res.text()}`);
}

// --- Main Loop ---
async function main() {
  const results = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const to = testNumber || String(lead.phone).replace(/\D/g, '');
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
      const smsRes = await sendSMS(to, body);
      const messageId = smsRes.sms?.id || smsRes.provider_sid || 'unknown';
      console.log(`  ✅ Sent: ${messageId}`);
      await trackText(lead, messageId, body);
      results.push({ lead, status: 'sent', messageId, body });
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      results.push({ lead, status: 'failed', error: err.message, body });
    }

    // Rate limit: max 1 msg/sec
    if (i < leads.length - 1) await new Promise(r => setTimeout(r, 1100));
  }

  const resultsPath = `/tmp/group-b-results-${Date.now()}.json`;
  fs.writeFileSync(resultsPath, JSON.stringify({
    sent: results.filter(r => r.status === 'sent').length,
    failed: results.filter(r => r.status === 'failed').length,
    total: results.length,
    results,
  }, null, 2));

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
