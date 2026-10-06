import type { SupabaseClient } from '@supabase/supabase-js';
import { isBotUserAgent, verifySampleToken } from './samples';
import { isScannerIp } from './sampleEvents';

// Page views for the pages an outreach email links to that do not have their own events table (the pitch deck and the /try form).
// They go into calldesk_outreach_deck_events (migration 045), which nothing wrote to until now: deck views were PostHog-only.
// Same rules as sample views: signed token required, bots and mail scanners dropped, one event per message per hour.
export type PageEventName = 'view' | 'try_view';
export const PAGE_VIEW_DEDUPE_MS = 60 * 60 * 1000;
export type PageViewResult = 'recorded' | 'bot' | 'invalid_token' | 'duplicate' | 'error';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordPageView(supabase: SupabaseClient<any>, input: { token: unknown; event: PageEventName; userAgent: string | null | undefined; ip?: string | null; now?: number }): Promise<PageViewResult> {
  let messageId: string | null = null;
  try { messageId = typeof input.token === 'string' ? verifySampleToken(input.token) : null; } catch { messageId = null; }
  if (!messageId) return 'invalid_token';
  if (isBotUserAgent(input.userAgent) || isScannerIp(input.ip)) return 'bot';
  try {
    const since = new Date((input.now ?? Date.now()) - PAGE_VIEW_DEDUPE_MS).toISOString();
    const dup = await supabase.from('calldesk_outreach_deck_events').select('id').eq('message_id', messageId).eq('event', input.event).gte('created_at', since).limit(1);
    if (dup.error) throw new Error(dup.error.message);
    if ((dup.data ?? []).length > 0) return 'duplicate';
    const msg = await supabase.from('calldesk_outreach_messages').select('product').eq('id', messageId).maybeSingle();
    const { error } = await supabase.from('calldesk_outreach_deck_events').insert({ message_id: messageId, product: (msg.data?.product as string | undefined) ?? 'calldesk', event: input.event, is_bot: false });
    if (error) throw new Error(error.message);
    return 'recorded';
  } catch (err) {
    console.warn('[outreach/page-view] record failed:', err instanceof Error ? err.message : err);
    return 'error';
  }
}
