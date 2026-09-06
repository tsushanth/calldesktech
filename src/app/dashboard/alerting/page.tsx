'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOnboarding } from '@/context/OnboardingContext';

type TriggerType = 'transferred' | 'abandoned' | 'voicemail';

interface AlertRule {
  id: string;
  tenant_id: string;
  trigger_type: TriggerType;
  email: string;
  enabled: boolean;
  created_at: string;
}

const TRIGGERS: { value: TriggerType; label: string; description: string }[] = [
  { value: 'transferred', label: 'Call transferred', description: 'When a call is handed off to a human.' },
  { value: 'abandoned', label: 'Call abandoned', description: 'When a caller hangs up before connecting, or no one answers.' },
  { value: 'voicemail', label: 'Voicemail reached', description: 'When the call ends up in voicemail instead of a person.' },
];

const TRIGGER_LABEL: Record<TriggerType, string> = {
  transferred: 'Call transferred',
  abandoned: 'Call abandoned',
  voicemail: 'Voicemail reached',
};

export default function AlertingPage() {
  const { tenantId, ownerEmail, isHydrated } = useOnboarding();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create-form state
  const [triggerType, setTriggerType] = useState<TriggerType>('transferred');
  const [email, setEmail] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadRules = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/alert-rules?tenantId=${encodeURIComponent(tenantId)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load alerts');
      setRules(body.rules);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load alerts' });
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!tenantId) {
      setIsLoading(false);
      return;
    }
    loadRules();
  }, [tenantId, isHydrated, loadRules]);

  // Prefill the email with the signed-in owner's address as a sensible default.
  useEffect(() => {
    if (ownerEmail && !email) setEmail(ownerEmail);
  }, [ownerEmail, email]);

  const handleCreate = async () => {
    if (!tenantId || !email.trim()) return;
    setIsCreating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/alert-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, triggerType, email: email.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to create alert');
      setRules((prev) => [...prev, body.rule]);
      setMessage({ type: 'success', text: 'Alert created.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create alert' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (rule: AlertRule) => {
    // Optimistic flip; roll back on failure.
    const next = !rule.enabled;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)));
    try {
      const res = await fetch(`/api/alert-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      setMessage({ type: 'error', text: 'Could not update that alert.' });
    }
  };

  const handleDelete = async (rule: AlertRule) => {
    const prev = rules;
    setRules((cur) => cur.filter((r) => r.id !== rule.id));
    try {
      const res = await fetch(`/api/alert-rules/${rule.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch {
      setRules(prev);
      setMessage({ type: 'error', text: 'Could not delete that alert.' });
    }
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Alerting</h1>
        <p className="mt-1 text-[13.5px] text-gray-500">
          Get an email the moment a call ends a certain way — transferred, abandoned, or sent to voicemail.
        </p>
      </div>

      {message && (
        <div
          className={`mb-5 rounded-lg px-4 py-3 text-[13.5px] ${
            message.type === 'success'
              ? 'border border-green-200 bg-green-50 text-green-700'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {!tenantId && isHydrated ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-[13.5px] text-gray-400">
          Set up your receptionist first — alerts attach to your business.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Create a new rule */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-[#1a1d29]">
              <span className="text-gray-400"><IconBell /></span>
              <span>New alert</span>
            </h2>

            <div className="mb-4">
              <label className="mb-2 block text-[12.5px] font-medium text-gray-500">Trigger</label>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                {TRIGGERS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTriggerType(t.value)}
                    className={`rounded-lg border p-3.5 text-left transition ${
                      triggerType === t.value ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <p className="text-[13px] font-medium text-[#1a1d29]">{t.label}</p>
                    <p className="mt-0.5 text-[12px] text-gray-500">{t.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Send to</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@business.com"
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={isCreating || !email.trim() || !tenantId}
                className="rounded-lg bg-[#1a1d29] px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d] disabled:opacity-50"
              >
                {isCreating ? 'Adding…' : 'Add alert'}
              </button>
            </div>
          </div>

          {/* Existing rules */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-[#1a1d29]">
              <span className="text-gray-400"><IconList /></span>
              <span>Your alerts</span>
            </h2>

            {isLoading ? (
              <p className="py-6 text-center text-[13.5px] text-gray-400">Loading…</p>
            ) : rules.length === 0 ? (
              <p className="py-6 text-center text-[13.5px] text-gray-400">No alerts yet. Create one above.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {rules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-[#1a1d29]">{TRIGGER_LABEL[rule.trigger_type]}</p>
                      <p className="truncate text-[12.5px] text-gray-500">{rule.email}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <Toggle checked={rule.enabled} onChange={() => handleToggle(rule)} />
                      <button
                        onClick={() => handleDelete(rule)}
                        aria-label="Delete alert"
                        className="rounded-lg border border-gray-200 p-2 text-gray-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition ${
        checked ? 'bg-blue-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function IconBell() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>; }
function IconList() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>; }
function IconTrash() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>; }
