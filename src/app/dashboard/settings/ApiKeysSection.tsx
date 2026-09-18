'use client';

import { useCallback, useEffect, useState } from 'react';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export default function ApiKeysSection({ tenantId }: { tenantId: string }) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/api-keys`);
      const body = await res.json();
      if (res.ok) setKeys(body.keys || []);
    } catch {
      // Non-fatal — the section just shows no keys.
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setIsCreating(true);
    setError('');
    try {
      const res = await fetch(`/api/tenants/${tenantId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'API key' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNewSecret(body.key.secret);
      setCopied(false);
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setIsCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this key? Anything using it stops working immediately.')) return;
    await fetch(`/api/tenants/${tenantId}/api-keys/${id}`, { method: 'DELETE' });
    await load();
  };

  const active = keys.filter((k) => !k.revoked_at);

  return (
    <div>
      <p className="mb-4 text-[13.5px] text-gray-500">
        Use a key to call the CallDeskTech API from your own servers or from the MCP server:{' '}
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">Authorization: Bearer cdk_live_…</code>. A key can only access this workspace.
      </p>

      {newSecret && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3.5">
          <p className="mb-2 text-[12.5px] font-medium text-amber-800">Copy this key now — it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded bg-white px-3 py-2 font-mono text-[12px] text-gray-800">{newSecret}</code>
            <button
              type="button"
              onClick={async () => {
                try { await navigator.clipboard.writeText(newSecret); setCopied(true); } catch { /* clipboard blocked */ }
              }}
              className="shrink-0 rounded-lg bg-[#1a1d29] px-3 py-2 text-[12.5px] font-medium text-white hover:bg-[#2a2e3d]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => setNewSecret(null)} className="shrink-0 text-[12.5px] text-gray-500 hover:text-gray-700">Done</button>
          </div>
        </div>
      )}

      <div className="mb-4 flex max-w-md gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name, e.g. Production server"
          maxLength={100}
          className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="button"
          onClick={create}
          disabled={isCreating}
          className="shrink-0 rounded-lg bg-[#1a1d29] px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-[#2a2e3d] disabled:opacity-40"
        >
          {isCreating ? 'Creating…' : 'Create key'}
        </button>
      </div>
      {error && <p className="mb-3 text-[12.5px] text-red-600">{error}</p>}

      {active.length === 0 ? (
        <p className="text-[13px] text-gray-400">No active keys.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-gray-50 text-[11.5px] uppercase tracking-wide text-gray-500">
              <tr><th className="px-3.5 py-2">Name</th><th className="px-3.5 py-2">Key</th><th className="px-3.5 py-2">Created</th><th className="px-3.5 py-2">Last used</th><th /></tr>
            </thead>
            <tbody>
              {active.map((k) => (
                <tr key={k.id} className="border-t border-gray-100">
                  <td className="px-3.5 py-2.5 font-medium text-[#1a1d29]">{k.name}</td>
                  <td className="px-3.5 py-2.5 font-mono text-[12px] text-gray-500">{k.key_prefix}…</td>
                  <td className="px-3.5 py-2.5 text-gray-500">{fmt(k.created_at)}</td>
                  <td className="px-3.5 py-2.5 text-gray-500">{fmt(k.last_used_at)}</td>
                  <td className="px-3.5 py-2.5 text-right"><button type="button" onClick={() => revoke(k.id)} className="text-[12.5px] font-medium text-red-500 hover:text-red-600">Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
