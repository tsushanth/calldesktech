import { describe, it, expect } from 'vitest';
import { parseTenantUpdates, protectServerManagedSettings, SERVER_MANAGED_SETTINGS_KEYS } from '@/lib/tenantUpdates';

describe('parseTenantUpdates', () => {
  it('accepts exactly what the settings page sends', () => {
    const r = parseTenantUpdates({ name: 'Acme', settings: { voice: 'x', tone: 'warm' }, cal_api_key: null, cal_event_type_id: '123' });
    expect(r.ok).toBe(true);
  });
  it('refuses ownership, routing and bookkeeping columns', () => {
    for (const field of ['user_id', 'id', 'retell_agent_id', 'retell_llm_id', 'knowledge_base_id', 'created_at', 'updated_at', 'last_usage_reported_at', 'phone_number', 'stripe_customer_id', 'not_a_column']) {
      const r = parseTenantUpdates({ name: 'ok', [field]: 'x' });
      expect(r.ok, field).toBe(false);
      if (!r.ok) expect(r.error).toContain(field);
    }
  });
  it('validates types and rejects empty or non-object bodies', () => {
    for (const body of [null, 'x', 5, [], {}, { name: '' }, { name: 5 }, { name: 'a'.repeat(201) }, { settings: [] }, { settings: 'x' }, { cal_api_key: 5 }, { cal_event_type_id: {} }]) {
      expect(parseTenantUpdates(body).ok, JSON.stringify(body)).toBe(false);
    }
  });
  it('accepts null to clear the calendar fields', () => {
    expect(parseTenantUpdates({ cal_api_key: null, cal_event_type_id: null }).ok).toBe(true);
  });
});

describe('protectServerManagedSettings', () => {
  it('keeps existing server-managed values and ignores attempts to set or remove them', () => {
    const out = protectServerManagedSettings({ subscription_status: 'active', phone: '+1', tone: 'old' }, { tone: 'new', subscription_status: 'canceled', default_payment_method: 'pm_fake' });
    expect(out).toEqual({ tone: 'new', subscription_status: 'active' });
  });
  it('does not let a tenant invent managed keys that do not exist yet', () => {
    const out = protectServerManagedSettings({}, { subscription_status: 'active', plan: 'pro', tier: 'pro', voice: 'x' });
    expect(out).toEqual({ voice: 'x' });
    for (const k of SERVER_MANAGED_SETTINGS_KEYS) expect(k in out).toBe(false);
  });
  it('treats missing or odd existing settings as empty', () => {
    expect(protectServerManagedSettings(null, { a: 1 })).toEqual({ a: 1 });
    expect(protectServerManagedSettings('x', { a: 1, plan: 'x' })).toEqual({ a: 1 });
  });
});
