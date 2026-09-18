'use client';

import { useEffect, useState } from 'react';
import type { AgentVersion, PhoneNumber } from '@/types';

// Places a real call to the user's own phone via the existing
// POST /api/phone-numbers/[id]/call route (which places the call FROM a
// number using that number's outbound agent version, and is rate-limited per
// tenant). There is no engine API to pick a version directly, so a number
// must have the latest published version set as its Outbound agent.
export default function TestCallModal({
  tenantId,
  latestVersion,
  onClose,
}: {
  tenantId: string;
  latestVersion: AgentVersion | null;
  onClose: () => void;
}) {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromId, setFromId] = useState('');
  const [toNumber, setToNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadNumbers = async () => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/phone-numbers`);
      const body = await res.json();
      if (res.ok) setNumbers(body.phoneNumbers || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadNumbers(); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const eligible = numbers.filter((n) => latestVersion && n.outbound_agent_version_id === latestVersion.id);
  useEffect(() => {
    if (!fromId && eligible.length > 0) setFromId(eligible[0].id);
  }, [eligible, fromId]);

  const assign = async (n: PhoneNumber) => {
    if (!latestVersion) return;
    if (!window.confirm(`Set V${latestVersion.version_number} as the Outbound Call Agent on ${n.number}? This changes that number's outbound routing.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/phone-numbers/${n.id}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'outbound', agentVersionId: latestVersion.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      await loadNumbers();
      setFromId(n.id);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Failed to update routing' });
    } finally {
      setBusy(false);
    }
  };

  const call = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/phone-numbers/${fromId}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toNumber: toNumber.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Call failed');
      setMessage({ ok: true, text: 'Calling you now — pick up your phone.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Call failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-[#1a1d29]">Test call</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>
        {!latestVersion ? (
          <p className="text-[13px] text-gray-600">Publish this agent first — test calls use the latest published version.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[12.5px] text-gray-500">
              Calls your phone using the latest published version (V{latestVersion.version_number}). Unpublished edits in the builder are not included — Publish first.
            </p>
            <div>
              <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Your phone number (E.164)</label>
              <input value={toNumber} onChange={(e) => setToNumber(e.target.value)} placeholder="+15551234567" className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 font-mono text-[13.5px]" />
            </div>
            {loading ? (
              <p className="text-[12.5px] text-gray-400">Loading numbers…</p>
            ) : eligible.length > 0 ? (
              <div>
                <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Call from</label>
                <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[13.5px]">
                  {eligible.map((n) => <option key={n.id} value={n.id}>{n.number}</option>)}
                </select>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-800">
                <p className="mb-1.5">No phone number uses V{latestVersion.version_number} as its Outbound Call Agent.</p>
                {numbers.length === 0 ? (
                  <p>Add a phone number first.</p>
                ) : (
                  <div className="space-y-1">
                    {numbers.map((n) => (
                      <button key={n.id} type="button" disabled={busy} onClick={() => assign(n)} className="block font-medium underline disabled:opacity-40">
                        Use V{latestVersion.version_number} on {n.number}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {message && <p className={`text-[13px] ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-50">Close</button>
              <button onClick={call} disabled={busy || !fromId || !/^\+\d{7,15}$/.test(toNumber.trim())} className="rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white disabled:opacity-40">
                {busy ? 'Calling…' : 'Call me'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
