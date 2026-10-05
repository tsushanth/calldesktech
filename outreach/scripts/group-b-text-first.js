#!/usr/bin/env node
/**
 * Group B: Text-First Outreach (URL Link Drop)
 *
 * Usage:
 *   export CALLDESK_API_KEY=cdk_live_...
 *   node outreach/scripts/group-b-text-first.js --csv /tmp/callable-leads.csv --limit 50
 *
 * What it does:
 *   1. Reads leads from CSV
 *   2. Sends one text per lead with a link to /demo
 *   3. Tracks in Supabase outreach_text_campaign
 *
 * Template is a single short link drop. No conversation.
 * Recipient taps the link and completes onboarding in their browser.
 *
 * 10DLC note: Even with A2P/Toll-Free delays, short links have lower carrier
 * friction than multi-message conversations. Still best-effort delivery.
 */

// BLOCKED (2026-10-05): this script texts phone numbers taken from a CSV of leads, i.e. numbers scraped from business websites.
// Marketing texts to US numbers need prior express written consent, which scraped numbers do not have. The only supported marketing-SMS
// audience is the Supabase view calldesk_sms_marketing_audience (numbers people submitted on /try with the opt-in box ticked), and only
// once a MARKETING 10DLC campaign is approved. Do not remove this guard to run the script against scraped numbers.
console.error('group-b-text-first.js is disabled: it would text scraped numbers without consent. See the comment at the top of this file.');
process.exit(1);

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
const testNumber = arg('test-number');

if (!phoneNumberId) {
  console.error('--phone-number-id is required (CallDeskTech SMS number UUID)');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

const API_KEY = process.env.CALLDESK_API_KEY;
if (!API_KEY) {
  console.error('CALLDESK_API_KEY is required');
  process.exit(1);
}

// --- Load leads ---
const csvContent = fs.readFileSync(csvPath, 'utf8');
const records = parse(csvContent, { columns: true, skip_empty_lines: true });
const leads = records
  .filter(r => r.phone && String(r.phone).replace(/\D/g, '').length >= 10)
  .slice(0, limit);

console.log(`=== Group B: URL Link Drop ===`);
console.log(`Leads: ${leads.length}`);
console.log(`From number ID: ${phoneNumberId}`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
if (testNumber) console.log(`TEST: All texts go to ${testNumber}`);
console.log('');

// --- Helpers ---
function firstName(company) {
  return 'there';
}

function shortName(company) {
  return String(company).replace(/, (LLC|INC|LLP|Corp|DBA.*)$/i, '').trim();
}

function buildBody(lead) {
  const name = shortName(lead.company || lead.company_name);
  return `Hi ${firstName(name)}, does ${name} ever miss calls after hours? Free AI receptionist in 2 mins: https://calldesk.tech/demo\n\nReply STOP to opt out.`;
}

async function api(method, path, body) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
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

let tenantIdCache;
async function tenantId() {
  if (tenantIdCache) return tenantIdCache;
  const me = await api('GET', '/me');
  tenantIdCache = me.tenantId;
  return me.tenantId;
}

async function sendSMS(toNumber, body) {
  const tid = await tenantId();
  return api('POST', `/tenants/${tid}/sms`, {
    phoneNumberId,
    toNumber: toNumber.startsWith('+') ? toNumber : `+1${toNumber.replace(/\D/g, '')}`,
    body,
  });
}

async function trackText(lead, smsId, body) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const payload = {
    lead_rank: parseInt(lead.rank) || null,
    company_name: lead.company || lead.company_name,
    phone: String(lead.phone).replace(/\D/g, ''),
    email: lead.email || null,
    location: lead.location,
    score: parseInt(lead.score) || null,
    message_sid: smsId,
    body,
    status: 'sent',
    sent_at: new Date().toISOString(),
    onboarding_url: 'https://calldesk.tech/demo',
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

  if (!res.ok) console.warn(`  [track] Failed: ${await res.text()}`);
}

// --- Main ---
async function main() {
  const results = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const to = testNumber || `+1${String(lead.phone).replace(/\D/g, '')}`;
    const body = buildBody(lead);

    console.log(`[${i + 1}/${leads.length}] ${lead.company || lead.company_name}`);
    console.log(`  To: ${to}`);
    console.log(`  Body: ${body}`);

    if (dryRun) {
      console.log(`  [DRY RUN]`);
      results.push({ lead: lead.company || lead.company_name, status: 'dry-run', body });
      console.log('');
      continue;
    }

    try {
      const smsRes = await sendSMS(to, body);
      const smsId = smsRes.sms?.id || 'unknown';
      console.log(`  ✅ Sent: ${smsId}`);
      await trackText(lead, smsId, body);
      results.push({ lead: lead.company || lead.company_name, status: 'sent', smsId, body });
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
  console.log(`Sent: ${sent || 0}`);
  console.log(`Failed: ${failed || 0}`);
  if (dry) console.log(`Dry-run: ${dry}`);

  const resultsPath = `/tmp/group-b-results-${Date.now()}.json`;
  fs.writeFileSync(resultsPath, JSON.stringify({ sent, failed, dry, total: results.length, results }, null, 2));
  console.log(`\nResults saved: ${resultsPath}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
