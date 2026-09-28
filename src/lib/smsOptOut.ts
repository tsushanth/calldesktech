import { getSupabaseAdmin } from '@/lib/supabase';

// Cross-cutting SMS opt-out suppression list (see migration 058_sms_opt_outs.sql).
// A STOP/CANCEL/END/QUIT/UNSUBSCRIBE reply on ANY CallDesk number must suppress
// future sends to that number across every sending path -- trial onboarding SMS,
// the general inbound webhook, and outreach/tenant-triggered sends -- not just
// the one conversation it arrived on.

const STOP_KEYWORD_RE = /\b(stop|unsubscribe|cancel|end|quit)\b/i;
const HELP_KEYWORD_RE = /\bhelp\b/i;

export function isStopKeyword(text: string): boolean {
  return STOP_KEYWORD_RE.test(text) || /don't text/i.test(text) || /do not text/i.test(text);
}

export function isHelpKeyword(text: string): boolean {
  return HELP_KEYWORD_RE.test(text);
}

function normalize(phoneNumber: string): string {
  return phoneNumber.trim();
}

export async function recordOptOut(phoneNumber: string, source: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('sms_opt_outs')
    .upsert({ phone_number: normalize(phoneNumber), source, opted_out_at: new Date().toISOString() }, { onConflict: 'phone_number' });
  if (error) {
    console.error('[smsOptOut] failed to record opt-out:', error);
  }
}

export async function isOptedOut(phoneNumber: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('sms_opt_outs')
    .select('phone_number')
    .eq('phone_number', normalize(phoneNumber))
    .maybeSingle();
  if (error) {
    console.error('[smsOptOut] failed to check opt-out status:', error);
    return false; // fail open on read error -- don't block legitimate sends on a DB hiccup
  }
  return !!data;
}

export const HELP_TEXT =
  'CallDeskTech (KREATIVEKOALASOLUTIONS LLC): AI receptionist setup. Msg freq varies. Msg & data rates may apply. Reply STOP to unsubscribe. Support: support@calldesk.tech';

export const STOP_CONFIRMATION_TEXT = 'You have been unsubscribed and will not receive further messages from this number.';
