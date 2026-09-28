#!/usr/bin/env node
/**
 * Diagnostic: verify the SMS → trial onboarding pipeline
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uazpbuvqisbpykiuebbn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function query(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) {
    console.error(`${table} failed: ${res.status}`);
    return [];
  }
  return await res.json();
}

async function main() {
  const yourPhone = '+14256284887';
  const trialNumber = '+12245061194';

  console.log('=== DIAGNOSTIC ===\n');

  // 1. Check calldesk_sms_messages for YOUR inbound
  console.log('1. Inbound SMS to trial number (+12245061194):');
  const inbound = await query('calldesk_sms_messages', `?direction=eq.inbound&to_number=eq.${trialNumber}&order=created_at.desc&limit=5`);
  if (!inbound.length) {
    console.log('   ❌ NONE FOUND');
    console.log('   → Telnyx webhook may not be configured for +12245061194');
    console.log('   → Or the SMS was sent but webhook failed');
  } else {
    for (const m of inbound) {
      const isYou = m.from_number === yourPhone;
      console.log(`   ${isYou ? '✅ YOU' : '   '} ${m.from_number}: "${m.body?.substring(0,60)}" (${m.created_at})`);
    }
  }

  // 2. Check trial_sms_sessions
  console.log('\n2. Trial SMS sessions for your phone:');
  const sessions = await query('trial_sms_sessions', `?from_phone=eq.${yourPhone.replace('+','')}&order=created_at.desc&limit=3`);
  if (!sessions.length) {
    console.log('   ❌ No session found');
    console.log('   → trial-sms-onboarding.js never processed your message');
  } else {
    for (const s of sessions) {
      console.log(`   step=${s.step}, company=${s.company_name || '(none)'}, assigned=${s.assigned_number || '(none)'}`);
    }
  }

  // 3. Check trial_sms_messages (processed log)
  console.log('\n3. Processed messages junction table:');
  const processed = await query('trial_sms_messages', `?select=body,processed_at,sms_message_id&order=processed_at.desc&limit=5`);
  if (!processed.length) {
    console.log('   ❌ Empty — trial-sms-onboarding.js has processed nothing yet');
  } else {
    for (const p of processed.slice(0, 3)) {
      console.log(`   "${p.body?.substring(0,50)}" at ${p.processed_at}`);
    }
  }

  // 4. Check if onboarding script is running
  console.log('\n4. Is trial-sms-onboarding.js running?');
  try {
    const { execSync } = await import('node:child_process');
    const ps = execSync('ps aux | grep trial-sms-onboarding | grep -v grep || echo "NOT RUNNING"', { encoding: 'utf8' });
    if (ps.includes('NOT RUNNING')) {
      console.log('   ❌ NOT RUNNING');
      console.log('   → Start it: node outreach/scripts/trial-sms-onboarding.js --interval 30');
    } else {
      console.log('   ✅ Running');
      console.log('   ' + ps.split('\n')[0].substring(0, 120));
    }
  } catch {
    console.log('   ⚠️ Could not check processes');
  }

  console.log('\n=== RECOMMENDATION ===');
  if (!inbound.length) {
    console.log('Fix Telnyx webhook for +12245061194. Inbound SMS is not reaching calldesk_sms_messages.');
  } else if (!sessions.length && !processed.length) {
    console.log('SMS arrived but trial-sms-onboarding.js is not running. Start it now.');
  } else {
    console.log('Data looks OK. Check the script logs for errors.');
  }
}

main();
