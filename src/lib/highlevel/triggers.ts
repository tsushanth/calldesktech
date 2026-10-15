import { getSupabaseAdmin } from '@/lib/supabase';
import { generateWebhookSecret } from '@/lib/webhooks';

// The HighLevel workflow trigger "Calldesk call completed" (key call_completed).
// HighLevel tells our Subscription URL when a workflow starts, changes or stops using the trigger, and gives us the URL to POST
// to when the trigger should fire. We keep one calldesk_webhooks row per subscription (flat payload, call.completed), so the
// existing signed, time-limited, SSRF-guarded delivery sends the call result to HighLevel.
// Trigger filters are not applied here: a workflow filters on the delivered fields with its own If/Else step.

export const CALL_COMPLETED_KEY = 'call_completed';
const SUBS = 'calldesk_highlevel_trigger_subscriptions';
const HL_HOST = 'services.leadconnectorhq.com';
const EXECUTE_PREFIX = '/workflows-marketplace/triggers/execute/';

/**
 * The trigger execute URL, or null when it is not one. Only https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/
 * <id>/<triggerId> is accepted, and <id> must be this sub-account or its company: otherwise anyone holding the app secret could
 * point a workspace's call results at another HighLevel account's workflow.
 */
export function validateTargetUrl(raw: unknown, allowedIds: Array<string | undefined>): string | null {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== HL_HOST || u.port || u.username || u.password || u.search || u.hash) return null;
  if (!u.pathname.startsWith(EXECUTE_PREFIX)) return null;
  const [id, triggerId, ...rest] = u.pathname.slice(EXECUTE_PREFIX.length).split('/');
  if (!id || !triggerId || rest.length || !/^[A-Za-z0-9_-]+$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(triggerId)) return null;
  if (!allowedIds.filter(Boolean).includes(id)) return null;
  return u.toString();
}

export interface SubscriptionEvent {
  triggerData?: { id?: unknown; key?: unknown; eventType?: unknown; targetUrl?: unknown };
  extras?: { locationId?: unknown; companyId?: unknown };
}

type Result = { ok: true } | { ok: false; status: number; error: string };

export async function applySubscription(evt: SubscriptionEvent, tenantId: string, locationId: string): Promise<Result> {
  const t = evt.triggerData ?? {};
  const triggerId = typeof t.id === 'string' ? t.id : '';
  if (!triggerId) return { ok: false, status: 400, error: 'triggerData.id is missing' };
  if (t.key !== CALL_COMPLETED_KEY) return { ok: false, status: 400, error: `Unknown trigger key (expected ${CALL_COMPLETED_KEY})` };
  const db = getSupabaseAdmin();

  if (t.eventType === 'DELETED') {
    const { data: sub } = await db.from(SUBS).select('id, webhook_id').eq('location_id', locationId).eq('hl_trigger_id', triggerId).maybeSingle();
    if (sub?.webhook_id) await db.from('calldesk_webhooks').delete().eq('id', sub.webhook_id).eq('tenant_id', tenantId);
    await db.from(SUBS).delete().eq('location_id', locationId).eq('hl_trigger_id', triggerId);
    return { ok: true };
  }
  if (t.eventType !== 'CREATED' && t.eventType !== 'UPDATED') return { ok: false, status: 400, error: 'Unknown eventType' };

  const companyId = typeof evt.extras?.companyId === 'string' ? evt.extras.companyId : undefined;
  const url = validateTargetUrl(t.targetUrl, [locationId, companyId]);
  if (!url) return { ok: false, status: 400, error: 'targetUrl is not a HighLevel trigger execute URL for this account' };

  const { data: sub } = await db.from(SUBS).select('id, webhook_id').eq('location_id', locationId).eq('hl_trigger_id', triggerId).maybeSingle();
  const now = new Date().toISOString();
  if (sub?.webhook_id) {
    const { error } = await db.from('calldesk_webhooks').update({ url, tenant_id: tenantId, enabled: true, updated_at: now }).eq('id', sub.webhook_id);
    if (error) return { ok: false, status: 500, error: 'Could not update the subscription' };
    await db.from(SUBS).update({ target_url: url, updated_at: now }).eq('id', sub.id);
    return { ok: true };
  }
  const { data: wh, error: whErr } = await db
    .from('calldesk_webhooks')
    .insert({ tenant_id: tenantId, url, events: ['call.completed'], enabled: true, secret: generateWebhookSecret(), format: 'flat' })
    .select('id')
    .single();
  if (whErr || !wh) return { ok: false, status: 500, error: 'Could not create the subscription' };
  const { error: subErr } = await db.from(SUBS).upsert({ location_id: locationId, hl_trigger_id: triggerId, trigger_key: CALL_COMPLETED_KEY, target_url: url, webhook_id: wh.id, updated_at: now }, { onConflict: 'location_id,hl_trigger_id' });
  if (subErr) {
    await db.from('calldesk_webhooks').delete().eq('id', wh.id);
    return { ok: false, status: 500, error: 'Could not save the subscription' };
  }
  return { ok: true };
}

/** Stop sending call results to HighLevel for a sub-account (uninstall, or the app being removed). */
export async function removeSubscriptionsForLocation(locationId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { data } = await db.from(SUBS).select('webhook_id').eq('location_id', locationId);
  const ids = ((data ?? []) as Array<{ webhook_id: string | null }>).map((r) => r.webhook_id).filter((x): x is string => !!x);
  for (const id of ids) await db.from('calldesk_webhooks').delete().eq('id', id);
  await db.from(SUBS).delete().eq('location_id', locationId);
}

/** The sub-account was linked to a different workspace: its trigger webhooks must belong to the new one. */
export async function moveSubscriptionsToTenant(locationId: string, tenantId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { data } = await db.from(SUBS).select('webhook_id').eq('location_id', locationId);
  for (const r of (data ?? []) as Array<{ webhook_id: string | null }>) {
    if (r.webhook_id) await db.from('calldesk_webhooks').update({ tenant_id: tenantId, updated_at: new Date().toISOString() }).eq('id', r.webhook_id);
  }
}
