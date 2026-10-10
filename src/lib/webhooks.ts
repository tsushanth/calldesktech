import { safeFetch } from '@/lib/safeFetch';
import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildFlatPayload, type WebhookFormat } from '@/lib/webhookFlat';

// The authoritative list of events a tenant can subscribe an outbound webhook
// to. Keep this in sync with the checkboxes on the Integrations page and the
// call points that actually emit them (see src/app/api/webhooks/retell). Each
// entry is a stable, dotted event name that goes into the delivery body's
// `event` field and the X-CallDesk-Event header.
export const WEBHOOK_EVENTS = [
  {
    id: 'call.started',
    label: 'Call started',
    description: 'Fires when a call connects (Retell-engine calls only).',
  },
  {
    id: 'call.completed',
    label: 'Call completed',
    description: 'Fires when a call ends, with its final outcome and transcript.',
  },
  {
    id: 'call.transferred',
    label: 'Call transferred',
    description: 'Fires when a call is handed off to a human (transfer).',
  },
  {
    id: 'call.analyzed',
    label: 'Call analyzed',
    description: "Fires after post-call analysis runs, with the extracted `analysis` fields (only for agents with post-call analysis configured).",
  },
  {
    id: 'sms.received',
    label: 'SMS received',
    description: "Fires when an inbound SMS arrives at one of your numbers.",
  },
  {
    id: 'sms.sent',
    label: 'SMS sent',
    description: "Fires when an outbound SMS is accepted by the provider.",
  },
] as const;

export type WebhookEventId = (typeof WEBHOOK_EVENTS)[number]['id'];

export const WEBHOOK_EVENT_IDS = WEBHOOK_EVENTS.map((e) => e.id) as WebhookEventId[];

// One stored endpoint. `secret` is only ever read server-side (to sign).
export interface WebhookRow {
  id: string;
  tenant_id: string;
  url: string;
  events: string[];
  enabled: boolean;
  secret: string;
  /** 'nested' (default) or 'flat'; absent on rows from before the column existed. */
  format?: WebhookFormat | null;
}

// A `whsec_`-prefixed random secret, mirroring Stripe's signing-secret shape.
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

// HMAC-SHA256 over the EXACT bytes we send as the request body, hex-encoded —
// the same construction the realtime-tts gateway uses for its session tokens
// (crypto.createHmac('sha256', secret).update(payload)) and that Stripe uses
// for its webhook signatures. The receiver recomputes this over the raw body
// they received and compares in constant time to trust the delivery.
export function signWebhookPayload(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// A single delivery. Returns whether the endpoint accepted it (2xx) plus the
// status, so callers (notably the "Send test event" button) can report back.
export async function deliverWebhook(
  webhook: Pick<WebhookRow, 'url' | 'secret'> & { format?: WebhookFormat | null },
  event: string,
  data: Record<string, unknown>
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const createdAt = new Date().toISOString();
  // Opt-in flat shape for no-code tools; the default nested shape is unchanged. Signing and headers are
  // identical either way: HMAC over the exact bytes sent.
  const payload = webhook.format === 'flat'
    ? buildFlatPayload(event, createdAt, data)
    : { event, created_at: createdAt, data };
  // Sign the exact serialized string we're about to send — signing a
  // re-serialization would risk key-ordering drift between what we signed and
  // what we transmitted.
  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(webhook.secret, body);

  try {
    // Bound each delivery so one slow/hung endpoint can't wedge the caller
    // (the Retell webhook handler dispatches these inline).
    // The URL is tenant-controlled: safeFetch refuses private/internal destinations (re-checked on every delivery and
    // on every redirect hop), caps the time and the response, and never lets a redirect carry our headers elsewhere.
    const res = await safeFetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'CallDesk-Webhooks/1',
        'X-CallDesk-Event': event,
        'X-CallDesk-Signature': `sha256=${signature}`,
      },
      body,
      timeoutMs: 8000,
      maxBytes: 100_000,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : 'Delivery failed',
    };
  }
}

// Fan a single event out to every enabled endpoint for a tenant that is
// subscribed to it. Best-effort by design: this runs inline in the Retell
// webhook handler, so a failing customer endpoint must never fail our own
// webhook response. All failures are swallowed (logged), and deliveries run
// in parallel.
export async function dispatchWebhookEvent(
  tenantId: string,
  event: WebhookEventId,
  data: Record<string, unknown>,
  // Merged into the payload only for webhooks registered with format "flat" (e.g. call_log_id, variables).
  flatExtras?: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: webhooks, error } = await supabase
      .from('calldesk_webhooks')
      .select('*') // '*' so a deploy before the `format` migration still works (format then reads as undefined = nested)
      .eq('tenant_id', tenantId)
      .eq('enabled', true)
      .contains('events', [event]);

    if (error) {
      console.error('Failed to load webhooks for dispatch:', error);
      return;
    }
    if (!webhooks || webhooks.length === 0) return;

    await Promise.all(
      webhooks.map(async (wh: Pick<WebhookRow, 'id' | 'url' | 'secret' | 'format'>) => {
        const result = await deliverWebhook(wh, event, wh.format === 'flat' && flatExtras ? { ...data, ...flatExtras } : data);
        if (!result.ok) {
          console.error(
            `Webhook ${wh.id} delivery failed (${event}):`,
            result.status ?? result.error
          );
        }
      })
    );
  } catch (err) {
    // Never let webhook dispatch throw into the caller's critical path.
    console.error('dispatchWebhookEvent error:', err);
  }
}
