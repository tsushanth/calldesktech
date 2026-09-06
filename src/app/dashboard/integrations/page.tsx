'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';

// Client-side mirror of the events a webhook can subscribe to. The server
// (src/lib/webhooks.ts WEBHOOK_EVENTS) is authoritative and re-validates every
// subscription; this copy exists only so the config UI doesn't have to import
// that server module (it pulls in node:crypto and the Supabase admin client).
const WEBHOOK_EVENTS = [
  {
    id: 'call.completed',
    label: 'call.completed',
    description: 'When a call ends, with its outcome and transcript.',
  },
  {
    id: 'call.transferred',
    label: 'call.transferred',
    description: 'When a call is handed off to a human.',
  },
] as const;

interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  secret: string;
  created_at: string;
}

export default function IntegrationsPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Integrations</h1>
        <p className="mt-0.5 text-[13px] text-gray-500">
          Connect CallDesk to the tools you already use. Webhooks are live now — more coming soon.
        </p>
      </div>

      <Catalog />

      <div className="mt-8">
        <WebhooksSection />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Catalog grid                                                        */
/* ------------------------------------------------------------------ */

function Catalog() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <CatalogCard
        icon={<IconCalendar />}
        name="Cal.com"
        description="Real-time appointment booking during calls."
        status="connected"
        href="/dashboard/settings"
        action="Configure in Settings"
      />
      <CatalogCard
        icon={<IconWebhook />}
        name="Webhooks"
        description="POST signed call events to your own endpoints."
        status="active"
        href="#webhooks"
        action="Manage below"
      />
      <CatalogCard icon={<IconSlack />} name="Slack" description="Post call summaries to a channel." status="soon" />
      <CatalogCard icon={<IconZapier />} name="Zapier" description="Trigger 6,000+ apps on call events." status="soon" />
      <CatalogCard icon={<IconHubspot />} name="HubSpot" description="Log calls as CRM activities." status="soon" />
    </div>
  );
}

function CatalogCard({
  icon,
  name,
  description,
  status,
  href,
  action,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  status: 'connected' | 'active' | 'soon';
  href?: string;
  action?: string;
}) {
  const badge =
    status === 'connected' ? (
      <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-700">Connected</span>
    ) : status === 'active' ? (
      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">Active</span>
    ) : (
      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-500">Coming soon</span>
    );

  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-50 text-gray-600">{icon}</div>
        {badge}
      </div>
      <h3 className="mt-3 text-[14px] font-semibold text-[#1a1d29]">{name}</h3>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-500">{description}</p>
      {action && <p className="mt-3 text-[12.5px] font-medium text-blue-600">{action} →</p>}
    </>
  );

  if (status === 'soon' || !href) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 opacity-70">{inner}</div>
    );
  }

  return (
    <Link
      href={href}
      className="block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-sm"
    >
      {inner}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Webhooks management                                                 */
/* ------------------------------------------------------------------ */

function WebhooksSection() {
  const { tenantId, isHydrated } = useOnboarding();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(WEBHOOK_EVENTS.map((e) => e.id));
  const [isCreating, setIsCreating] = useState(false);

  // The plaintext secret is only surfaced once, right after creating an
  // endpoint — thereafter it lives server-side for signing.
  const [newSecret, setNewSecret] = useState<{ url: string; secret: string } | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/webhooks`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setWebhooks(body.webhooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isHydrated) load();
  }, [isHydrated, load]);

  const toggleEvent = (id: string) => {
    setSelectedEvents((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  };

  const handleCreate = async () => {
    if (!tenantId || !url.trim() || selectedEvents.length === 0) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events: selectedEvents }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setWebhooks((prev) => [body.webhook, ...prev]);
      setNewSecret({ url: body.webhook.url, secret: body.webhook.secret });
      setUrl('');
      setSelectedEvents(WEBHOOK_EVENTS.map((e) => e.id));
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (wh: Webhook) => {
    setBusyId(wh.id);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !wh.enabled }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setWebhooks((prev) => prev.map((w) => (w.id === wh.id ? body.webhook : w)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update webhook');
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (wh: Webhook) => {
    setBusyId(wh.id);
    setTestResult((prev) => ({ ...prev, [wh.id]: 'Sending…' }));
    try {
      const res = await fetch(`/api/tenants/${tenantId}/webhooks/${wh.id}/test`, { method: 'POST' });
      const body = await res.json();
      setTestResult((prev) => ({
        ...prev,
        [wh.id]: body.success ? `Delivered (${body.status})` : `Failed: ${body.error}`,
      }));
    } catch {
      setTestResult((prev) => ({ ...prev, [wh.id]: 'Failed to send' }));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (wh: Webhook) => {
    if (!confirm(`Delete webhook ${wh.url}?`)) return;
    setBusyId(wh.id);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/webhooks/${wh.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error);
      }
      setWebhooks((prev) => prev.filter((w) => w.id !== wh.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div id="webhooks" className="scroll-mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1d29]">Webhooks</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">
            We POST a signed JSON payload to each endpoint when a subscribed call event fires. Verify the{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-[12px]">X-CallDesk-Signature</code> header (HMAC-SHA256 of the raw body).
          </p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="whitespace-nowrap rounded-lg bg-[#1a1d29] px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-[#2a2e3d]"
        >
          + Add endpoint
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{error}</div>
      )}

      {newSecret && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-[13.5px] font-medium text-green-800">Endpoint added — copy your signing secret now</p>
          <p className="mt-0.5 text-[12.5px] text-green-700">
            This is the only time we&apos;ll show it. Use it to verify the <code>X-CallDesk-Signature</code> header on{' '}
            <span className="font-medium">{newSecret.url}</span>.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-green-200 bg-white px-3 py-2 text-[12.5px] text-gray-700">
              {newSecret.secret}
            </code>
            <button
              onClick={() => navigator.clipboard?.writeText(newSecret.secret)}
              className="rounded-lg border border-green-300 bg-white px-3 py-2 text-[12.5px] font-medium text-green-700 transition hover:bg-green-100"
            >
              Copy
            </button>
            <button
              onClick={() => setNewSecret(null)}
              className="rounded-lg px-3 py-2 text-[12.5px] font-medium text-green-700 transition hover:bg-green-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
          <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Endpoint URL</label>
          <input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhooks/calldesk"
            className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <p className="mb-2 mt-3 text-[12.5px] font-medium text-gray-500">Events</p>
          <div className="space-y-2">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev.id} className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(ev.id)}
                  onChange={() => toggleEvent(ev.id)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                />
                <span>
                  <code className="text-[13px] font-medium text-[#1a1d29]">{ev.label}</code>
                  <span className="ml-2 text-[12.5px] text-gray-500">{ev.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={isCreating || !url.trim() || selectedEvents.length === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              {isCreating ? 'Adding…' : 'Add endpoint'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-[13.5px] text-gray-600 transition hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60 text-[11.5px] uppercase tracking-wide text-gray-400">
              <th className="px-5 py-3 font-medium">Endpoint</th>
              <th className="px-5 py-3 font-medium">Events</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!isHydrated || isLoading ? (
              <tr>
                <td colSpan={4} className="px-5 py-14 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : webhooks.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-14 text-center text-gray-400">
                  No webhooks yet — add an endpoint to receive call events.
                </td>
              </tr>
            ) : (
              webhooks.map((wh) => (
                <tr key={wh.id} className="border-b border-gray-50 last:border-0 align-top hover:bg-gray-50/70">
                  <td className="px-5 py-3.5">
                    <span className="break-all font-medium text-[#1a1d29]">{wh.url}</span>
                    {testResult[wh.id] && (
                      <p className="mt-1 text-[12px] text-gray-500">{testResult[wh.id]}</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {wh.events.map((e) => (
                        <span key={e} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                          {e}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => handleToggle(wh)}
                      disabled={busyId === wh.id}
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition disabled:opacity-50 ${
                        wh.enabled ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {wh.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleTest(wh)}
                        disabled={busyId === wh.id}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px] font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                      >
                        Test
                      </button>
                      <button
                        onClick={() => handleDelete(wh)}
                        disabled={busyId === wh.id}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12.5px] font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}
function IconWebhook() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12a3 3 0 1 1 4.6 2.5" />
      <path d="m12 9-3.5 6a3 3 0 1 1-2.6-1.5" />
      <path d="M14 15h4.5a3 3 0 1 1-1.9 5.3" />
    </svg>
  );
}
function IconSlack() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="6" height="3" rx="1.5" />
      <rect x="11" y="14" width="3" height="6" rx="1.5" />
      <rect x="14" y="11" width="6" height="3" rx="1.5" />
      <rect x="10" y="4" width="3" height="6" rx="1.5" />
    </svg>
  );
}
function IconZapier() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function IconHubspot() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="12" r="3" />
      <circle cx="17" cy="7" r="2.5" />
      <path d="M10 12h4.5M16 9.3 14 11" />
      <path d="M17 9.5V15a2 2 0 0 1-2 2H9" />
    </svg>
  );
}
