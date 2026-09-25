import type { SupabaseClient } from '@supabase/supabase-js';
import { sendApprovedMessage, sentTodayCount, dailyCap, type SendOutcome } from './sender';

// Paced, automatic sending of messages that were already approved in the queue.
// One message per tick, only inside a weekday send window, spaced so the daily cap
// is spread across the window, and paused automatically when recent deliverability
// looks bad. Drafts are never sent from here; approval in the queue stays manual.

const CALLDESK_PRODUCTS = 'product.eq.calldesk,product.like.calldesk:%';
const HEALTH_WINDOW_MS = 7 * 24 * 3600_000;
const IN_CHUNK = 100;
let running = false;

export type AutosendResult =
  | { action: 'disabled' }
  | { action: 'outside_window'; localHour: number; weekday: string }
  | { action: 'paused_health'; reason: string }
  | { action: 'cap_reached'; sent: number; cap: number }
  | { action: 'too_soon'; minutesSinceLast: number; minGapMinutes: number }
  | { action: 'nothing_approved' }
  | { action: 'would_send'; messageId: string }
  | { action: 'sent'; messageId: string }
  | { action: 'send_failed'; messageId: string; error: string }
  | { action: 'busy' };

export function localParts(now: Date, tz = process.env.OUTREACH_TZ || 'America/Los_Angeles'): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(now);
  return { hour: Number(parts.find((p) => p.type === 'hour')?.value) % 24, weekday: String(parts.find((p) => p.type === 'weekday')?.value) };
}

export function sendWindow(): { start: number; end: number } {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(process.env.OUTREACH_SEND_HOURS || '9-16');
  const start = m ? Number(m[1]) : 9;
  const end = m ? Number(m[2]) : 16;
  return end > start && start >= 0 && end <= 24 ? { start, end } : { start: 9, end: 16 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function healthProblem(supabase: SupabaseClient<any>, now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_MS).toISOString();
  const { count: sentCount } = await supabase
    .from('calldesk_outreach_messages').select('id', { count: 'exact', head: true })
    .eq('status', 'sent').or(CALLDESK_PRODUCTS).gte('sent_at', since);
  const { data: events } = await supabase
    .from('calldesk_outreach_email_events').select('message_id,event')
    .in('event', ['bounced', 'complained']).gte('occurred_at', since).limit(1000);
  const byMessage = new Map<string, string>();
  for (const e of (events ?? []) as { message_id: string | null; event: string }[]) if (e.message_id) byMessage.set(e.message_id, e.event);
  const ids = [...byMessage.keys()];
  let bounced = 0;
  let complained = 0;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data } = await supabase.from('calldesk_outreach_messages').select('id').in('id', ids.slice(i, i + IN_CHUNK)).or(CALLDESK_PRODUCTS);
    for (const m of (data ?? []) as { id: string }[]) byMessage.get(m.id) === 'complained' ? complained++ : bounced++;
  }
  if (complained > 0) return `${complained} spam complaint(s) in the last 7 days`;
  const maxBounce = Number(process.env.OUTREACH_AUTOSEND_MAX_BOUNCE) || 0.05;
  const sent = sentCount ?? 0;
  if (sent >= 20 && bounced / sent >= maxBounce) return `bounce rate ${(100 * bounced / sent).toFixed(1)}% (${bounced} of ${sent}) over the last 7 days`;
  return null;
}

export async function runAutosend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  opts: { now?: Date; dry?: boolean; send?: (id: string) => Promise<SendOutcome> } = {},
): Promise<AutosendResult> {
  const now = opts.now ?? new Date();
  if (process.env.OUTREACH_AUTOSEND !== 'on') return { action: 'disabled' };
  if (running) return { action: 'busy' };
  running = true;
  try {
    const { hour, weekday } = localParts(now);
    const { start, end } = sendWindow();
    if (weekday === 'Sat' || weekday === 'Sun' || hour < start || hour >= end) return { action: 'outside_window', localHour: hour, weekday };

    const problem = await healthProblem(supabase, now);
    if (problem) return { action: 'paused_health', reason: problem };

    const cap = dailyCap('calldesk');
    const sent = await sentTodayCount(supabase, 'calldesk');
    if (sent >= cap) return { action: 'cap_reached', sent, cap };

    const minGapMinutes = Math.floor(((end - start) * 60 / cap) * 0.9);
    const { data: last } = await supabase
      .from('calldesk_outreach_messages').select('sent_at').eq('status', 'sent').or(CALLDESK_PRODUCTS)
      .order('sent_at', { ascending: false }).limit(1);
    const lastAt = (last as { sent_at: string }[] | null)?.[0]?.sent_at;
    if (lastAt) {
      const minutesSinceLast = Math.floor((now.getTime() - new Date(lastAt).getTime()) / 60_000);
      if (minutesSinceLast < minGapMinutes) return { action: 'too_soon', minutesSinceLast, minGapMinutes };
    }

    const { data: candidates } = await supabase
      .from('calldesk_outreach_messages')
      .select('id, lead:calldesk_outreach_leads(replied_at)')
      .eq('status', 'approved').or(CALLDESK_PRODUCTS)
      .order('step', { ascending: true }).order('created_at', { ascending: true }).limit(20);
    const next = ((candidates ?? []) as { id: string; lead: { replied_at: string | null } | { replied_at: string | null }[] | null }[]).find((c) => {
      const lead = Array.isArray(c.lead) ? c.lead[0] : c.lead;
      return !lead?.replied_at;
    });
    if (!next) return { action: 'nothing_approved' };
    if (opts.dry) return { action: 'would_send', messageId: next.id };

    const out = await (opts.send ?? ((id: string) => sendApprovedMessage(supabase, id)))(next.id);
    return out.ok ? { action: 'sent', messageId: next.id } : { action: 'send_failed', messageId: next.id, error: out.error };
  } finally {
    running = false;
  }
}
