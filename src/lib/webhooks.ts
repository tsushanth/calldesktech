import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';

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
  webhook: Pick<WebhookRow, 'url' | 'secret'>,
  event: string,
  data: Record<string, unknown>
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const payload = {
    event,
    created_at: new Date().toISOString(),
    data,
  };
  // Sign the exact serialized string we're about to send — signing a
  // re-serialization would risk key-ordering drift between what we signed and
  // what we transmitted.
  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(webhook.secret, body);

  try {
    // Bound each delivery so one slow/hung endpoint can't wedge the caller
    // (the Retell webhook handler dispatches these inline).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CallDesk-Webhooks/1',
          'X-CallDesk-Event': event,
          'X-CallDesk-Signature': `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
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
  data: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: webhooks, error } = await supabase
      .from('calldesk_webhooks')
      .select('id, url, secret, events, enabled')
      .eq('tenant_id', tenantId)
      .eq('enabled', true)
      .contains('events', [event]);

    if (error) {
      console.error('Failed to load webhooks for dispatch:', error);
      return;
    }
    if (!webhooks || webhooks.length === 0) return;

    await Promise.all(
      webhooks.map(async (wh: Pick<WebhookRow, 'id' | 'url' | 'secret'>) => {
        const result = await deliverWebhook(wh, event, data);
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
