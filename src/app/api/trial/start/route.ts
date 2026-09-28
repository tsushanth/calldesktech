import { NextRequest, NextResponse } from 'next/server';
import { createTrialForSession } from '@/lib/trial-creator';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/trial/start
 *
 * Web-based trial onboarding. Replaces SMS conversation with a form.
 * Body: { company_name, greeting?, transfer_number, timezone?, email? }
 * Returns: { assigned_number, trial_id }
 */

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { company_name, greeting, transfer_number, timezone, email, phone } = body;

  // Validation
  if (!company_name || typeof company_name !== 'string' || company_name.trim().length < 2) {
    return NextResponse.json({ error: 'company_name required (min 2 chars)' }, { status: 400 });
  }
  if (!transfer_number || typeof transfer_number !== 'string') {
    return NextResponse.json({ error: 'transfer_number required' }, { status: 400 });
  }

  // Normalize transfer number
  const digits = transfer_number.replace(/\D/g, '');
  const normalizedTransfer = digits.length === 10 ? `+1${digits}`
    : digits.length === 11 && digits.startsWith('1') ? `+${digits}`
    : digits.length >= 12 ? `+${digits}`
    : null;
  if (!normalizedTransfer) {
    return NextResponse.json({ error: 'Invalid transfer_number' }, { status: 400 });
  }

  // Normalize phone (optional, for tracking)
  let fromPhone = phone ? phone.replace(/\D/g, '') : null;
  if (fromPhone) {
    fromPhone = fromPhone.length === 10 ? `+1${fromPhone}`
      : fromPhone.length === 11 && fromPhone.startsWith('1') ? `+${fromPhone}`
      : fromPhone.length >= 12 ? `+${fromPhone}`
      : null;
  }

  const tz = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix'].includes(timezone)
    ? timezone
    : 'America/New_York';

  // Create session record
  const supabase = getSupabaseAdmin();
  const { data: session, error: sessionErr } = await supabase
    .from('trial_sms_sessions')
    .insert({
      from_phone: fromPhone?.replace(/^\+/, '') || 'web',
      to_phone: 'web',
      step: 'completed',
      company_name: company_name.trim().slice(0, 60),
      greeting: (greeting || `Hi, this is ${company_name.trim()}. How can I help you?`).slice(0, 200),
      transfer_number: normalizedTransfer,
      timezone: tz,
    })
    .select()
    .single();

  if (sessionErr || !session) {
    console.error('[trial-start] failed to create session:', sessionErr);
    return NextResponse.json({ error: 'Failed to create trial session' }, { status: 500 });
  }

  // Create trial
  try {
    const result = await createTrialForSession(session.id);
    return NextResponse.json({
      trial_id: session.id,
      assigned_number: result.assigned_number,
      agent_id: result.agent_id,
      dashboard_url: `https://calldesk.tech/trial/${session.id}`,
    }, { status: 201 });
  } catch (err: any) {
    console.error('[trial-start] trial creation failed:', err.message);
    // Clean up session
    await supabase.from('trial_sms_sessions').delete().eq('id', session.id);
    return NextResponse.json({ error: err.message || 'Trial creation failed' }, { status: 502 });
  }
}
