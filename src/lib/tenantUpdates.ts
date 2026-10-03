// What a tenant (or an API key) may change on its own calldesk_tenants row through PATCH /api/tenants/[id].
// Everything else is refused: user_id (ownership), retell_agent_id / retell_llm_id (they decide which tenant an
// incoming Retell event belongs to), knowledge_base_id, id, timestamps, billing bookkeeping. The old route passed the
// request body straight to .update(), so any of those could be rewritten by the tenant itself.
export const TENANT_UPDATABLE_FIELDS = ['name', 'settings', 'cal_api_key', 'cal_event_type_id'] as const;
type Allowed = (typeof TENANT_UPDATABLE_FIELDS)[number];

export type TenantUpdateResult =
  | { ok: true; updates: Partial<Record<Allowed, unknown>> }
  | { ok: false; error: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseTenantUpdates(body: unknown): TenantUpdateResult {
  if (!isPlainObject(body)) return { ok: false, error: 'Request body must be a JSON object' };
  const rejected = Object.keys(body).filter((k) => !(TENANT_UPDATABLE_FIELDS as readonly string[]).includes(k));
  if (rejected.length) return { ok: false, error: `These fields cannot be changed here: ${rejected.join(', ')}` };
  const updates: Partial<Record<Allowed, unknown>> = {};
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) return { ok: false, error: 'name must be a non-empty string of at most 200 characters' };
    updates.name = body.name;
  }
  if ('settings' in body) {
    if (!isPlainObject(body.settings)) return { ok: false, error: 'settings must be an object' };
    updates.settings = body.settings;
  }
  if ('cal_api_key' in body) {
    if (body.cal_api_key !== null && typeof body.cal_api_key !== 'string') return { ok: false, error: 'cal_api_key must be a string or null' };
    updates.cal_api_key = body.cal_api_key;
  }
  if ('cal_event_type_id' in body) {
    const v = body.cal_event_type_id;
    if (v !== null && typeof v !== 'string' && typeof v !== 'number') return { ok: false, error: 'cal_event_type_id must be a string, number or null' };
    updates.cal_event_type_id = v;
  }
  if (!Object.keys(updates).length) return { ok: false, error: 'Nothing to update' };
  return { ok: true, updates };
}

// Keys inside `settings` that the server (Stripe webhook, go-live) manages and that other code trusts, for example
// the mobile app's "is activated" check. A tenant can save its own settings but cannot set, change or remove these.
export const SERVER_MANAGED_SETTINGS_KEYS = ['subscription_status', 'default_payment_method', 'stripe_customer_id', 'stripe_subscription_id', 'plan', 'tier'] as const;

export function protectServerManagedSettings(existing: unknown, incoming: Record<string, unknown>): Record<string, unknown> {
  const current = isPlainObject(existing) ? existing : {};
  const out: Record<string, unknown> = { ...incoming };
  for (const key of SERVER_MANAGED_SETTINGS_KEYS) {
    if (key in current) out[key] = current[key];
    else delete out[key];
  }
  return out;
}
