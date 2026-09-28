import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getSmsProvider } from '@/lib/smsProvider';

/**
 * POST /api/webhooks/trial-sms
 *
 * Inbound SMS webhook for trial onboarding.
 * Call this directly from Telnyx webhook config on the trial number,
 * or have the telnyx-sms handler forward matching messages here.
 */

function normalizeE164(num: string | null): string | null {
  if (typeof num !== 'string') return null;
  const digits = num.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 12) return `+${digits}`;
  if (num.trim().startsWith('+')) return num.trim();
  return null;
}

const TRIAL_ONBOARDING_NUMBER = normalizeE164(process.env.TRIAL_ONBOARDING_NUMBER || '+12245061194');

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const toNumber = normalizeE164(body.to || body.To);
  const fromNumber = normalizeE164(body.from || body.From);
  const text = (body.body || body.Body || body.text || '').trim();

  if (!toNumber || !fromNumber) {
    return NextResponse.json({ error: 'Missing to/from' }, { status: 400 });
  }
  if (toNumber !== TRIAL_ONBOARDING_NUMBER) {
    return NextResponse.json({ received: true, note: 'not trial number' }, { status: 200 });
  }

  const supabase = getSupabaseAdmin();

  // Resolve tenant from the phone number
  const { data: phoneRow } = await supabase
    .from('calldesk_phone_numbers')
    .select('tenant_id, id')
    .eq('number', toNumber)
    .maybeSingle();

  const tenantId = phoneRow?.tenant_id ?? null;
  const phoneId = phoneRow?.id ?? null;

  // Get or create session
  const { data: session, error: sessionErr } = await supabase
    .from('trial_sms_sessions')
    .select('*')
    .eq('from_phone', fromNumber.replace(/^\+/, ''))
    .eq('to_phone', toNumber.replace(/^\+/, ''))
    .maybeSingle();

  if (sessionErr) {
    console.error('[trial-sms] session lookup failed:', sessionErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  let currentSession = session || {
    id: null,
    from_phone: fromNumber.replace(/^\+/, ''),
    to_phone: toNumber.replace(/^\+/, ''),
    step: 'greeting',
    company_name: null,
    greeting: null,
    transfer_number: null,
    timezone: 'America/New_York',
  };

  if (!currentSession.id) {
    const { data: created, error: createErr } = await supabase
      .from('trial_sms_sessions')
      .insert({
        from_phone: currentSession.from_phone,
        to_phone: currentSession.to_phone,
        step: 'greeting',
      })
      .select()
      .single();
    if (createErr) {
      console.error('[trial-sms] create session failed:', createErr);
      return NextResponse.json({ error: 'DB create error' }, { status: 500 });
    }
    currentSession = created;
  }

  // Store inbound SMS record
  if (tenantId) {
    await supabase.from('calldesk_sms_messages').insert({
      tenant_id: tenantId,
      phone_number_id: phoneId,
      from_number: fromNumber,
      to_number: toNumber,
      body: text,
      direction: 'inbound',
      status: 'received',
    });
  }

  // Run state machine
  const result = await runStateMachine(supabase, currentSession, text, toNumber);

  // Send reply
  const provider = getSmsProvider();
  const sendResult = await provider.send({
    from: toNumber,
    to: fromNumber,
    body: result.reply,
  });

  // Store outbound SMS record
  if (tenantId) {
    await supabase.from('calldesk_sms_messages').insert({
      tenant_id: tenantId,
      phone_number_id: phoneId,
      from_number: toNumber,
      to_number: fromNumber,
      body: result.reply,
      direction: 'outbound',
      status: sendResult.status,
      error: sendResult.error,
    });
  }

  await supabase.from('trial_sms_messages').insert({
    session_id: currentSession.id,
    direction: 'outbound',
    body: result.reply,
  });

  return NextResponse.json({
    received: true,
    step: result.nextStep,
    replied: result.reply,
    smsStatus: sendResult.status,
  }, { status: 200 });
}

// ------------------------------------------------------------------
// State Machine
// ------------------------------------------------------------------
async function runStateMachine(supabase: any, session: any, body: string, fromNumberE164: string) {
  const step = session.step;
  const text = body.toLowerCase().trim();

  const send = (reply: string) => ({ reply, nextStep: step });

  // --- STOP handling universal ---
  if (/stop|unsubscribe|remove|don't text/i.test(text) && step !== 'completed') {
    await supabase.from('trial_sms_sessions').update({ step: 'completed' }).eq('id', session.id);
    return { reply: 'No problem. You will not receive any more messages.', nextStep: 'completed' };
  }

  switch (step) {
    case 'greeting': {
      if (text.includes('help')) {
        return send('Reply START to begin your free trial, or STOP to unsubscribe.');
      }
      if (text.match(/^(start|yes|ok|sure|go)/i)) {
        await supabase.from('trial_sms_sessions').update({ step: 'company_name' }).eq('id', session.id);
        return { reply: "Great. What's your business name?", nextStep: 'company_name' };
      }
      return send('Ready to set up your AI receptionist in 2 mins? Reply START to begin.');
    }

    case 'company_name': {
      const name = body.trim().slice(0, 60);
      if (name.length < 2) {
        return send('Please send your business name again.');
      }
      await supabase.from('trial_sms_sessions').update({ company_name: name, step: 'greeting_prompt' }).eq('id', session.id);
      return { reply: `Got it, ${name}. What should the AI say when it answers? Reply 1 for the default greeting, or type your own.`, nextStep: 'greeting_prompt' };
    }

    case 'greeting_prompt': {
      let greeting = body.trim().slice(0, 200);
      if (greeting === '1') {
        greeting = `Hi, this is ${session.company_name}. How can I help you?`;
      }
      if (greeting.length < 5) {
        return send('Please reply 1 for the default greeting, or type your own.');
      }
      await supabase.from('trial_sms_sessions').update({ greeting, step: 'transfer_number' }).eq('id', session.id);
      return { reply: 'What number should urgent calls transfer to? Reply with a 10-digit number (e.g. 4155551234).', nextStep: 'transfer_number' };
    }

    case 'transfer_number': {
      const digits = body.replace(/\D/g, '');
      const num = digits.length === 10 ? `+1${digits}`
        : digits.length === 11 && digits.startsWith('1') ? `+${digits}`
        : digits.length >= 12 ? `+${digits}`
        : null;
      if (!num) {
        return send('Please send a valid 10-digit phone number.');
      }
      await supabase.from('trial_sms_sessions').update({ transfer_number: num, step: 'timezone' }).eq('id', session.id);
      return { reply: 'What timezone? (e.g. America/New_York, America/Chicago, America/Los_Angeles)', nextStep: 'timezone' };
    }

    case 'timezone': {
      const raw = body.trim();
      const tz = raw.replace(/\s/g, '_').replace(/"/g, '');
      const valid = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix'];
      if (!valid.includes(tz)) {
        return send(`Please pick: ${valid.join(', ')}`);
      }
      await supabase.from('trial_sms_sessions').update({ timezone: tz }).eq('id', session.id);

      // Kick off trial creation asynchronously (don't block HTTP response)
      createTrialAsync(supabase, session.id).catch((err: any) => {
        console.error(`[trial-sms] async creation failed: ${err.message}`);
      });

      return { reply: "Perfect. Creating your AI receptionist now... one sec. I'll text you the number in a minute.", nextStep: 'completed' };
    }

    case 'completed': {
      if (text.includes('help')) {
        return send(`Dashboard: https://calldesk.tech/trial/${session.id}`);
      }
      return send(''); // No reply for completed sessions unless HELP
    }

    default: {
      return send('Reply START to set up your AI receptionist in 2 mins.');
    }
  }
}

// ------------------------------------------------------------------
// Async trial creation (forked, non-blocking)
// ------------------------------------------------------------------
async function createTrialAsync(supabase: any, sessionId: string) {
  const { data: session } = await supabase
    .from('trial_sms_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (!session || !session.company_name) return;

  // Call trial-creator.js via exec (same machine, runs in background)
  const { spawn } = await import('node:child_process');
  const child = spawn('node', [
    `${process.cwd()}/outreach/scripts/trial-creator.js`,
    '--session-id', sessionId,
  ], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log(`[trial-sms] Spawned trial-creator for session ${sessionId}`);
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
// (normalizeE164 defined at module top)
