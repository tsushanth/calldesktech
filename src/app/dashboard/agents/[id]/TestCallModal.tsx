'use client';

import { useEffect, useState } from 'react';
import type { AgentVersion, PhoneNumber } from '@/types';
import { formatPhoneE164 } from '@/lib/utils';
import { trackBuilder, errorProps } from '@/lib/builderTelemetry';
import { apiErrorText } from '@/lib/pilotBlockShared';
import { callFromOptions, friendlyCallError } from '@/lib/testCallNumbers';

// Places a real call to the user's own phone via the existing
// POST /api/phone-numbers/[id]/call route (which places the call FROM a
// number using that number's outbound agent version, and is rate-limited per
// tenant). There is no engine API to pick a version directly, so a number
// must have the latest published version set as its Outbound agent.
export default function TestCallModal({
  tenantId,
  latestVersion,
  onClose,
  onCallPlaced,
}: {
  tenantId: string;
  latestVersion: AgentVersion | null;
  onClose: () => void;
  /** Fired once the call has been requested, so the page can start following it through the flow. */
  onCallPlaced?: () => void;
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

  // Accept "(425) 628-4887", "425-628-4887", "+1 425 628 4887" etc. — the old
  // strict E.164 check left the Call button disabled with no explanation.
  const toE164 = !toNumber.trim()
    ? ''
    : toNumber.trim().startsWith('+')
      ? `+${toNumber.replace(/\D/g, '')}`
      : formatPhoneE164(toNumber);
  const toValid = /^\+\d{7,15}$/.test(toE164);

  // Every number is offered; the ones not yet using this version get a one-click "use it" below instead of a dead end.
  const options = callFromOptions(numbers, latestVersion?.id, latestVersion?.version_number);
  const selected = options.find((o) => o.id === fromId) ?? null;
  const eligible = options.filter((o) => o.ready);
  useEffect(() => {
    if (!fromId && options.length > 0) setFromId((eligible[0] ?? options[0]).id);
  }, [options, eligible, fromId]);

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
        body: JSON.stringify({ toNumber: toE164 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(apiErrorText(body, 'Call failed'));
      trackBuilder('test_call_started', { version_number: latestVersion?.version_number });
      setMessage({ ok: true, text: 'Calling you now — pick up your phone.' });
      // Close so the flow canvas is visible; the page shows a live-call pill from here.
      if (onCallPlaced) {
        onCallPlaced();
        onClose();
      }
    } catch (err) {
      trackBuilder('test_call_failed', errorProps(err));
      setMessage({ ok: false, text: friendlyCallError(err instanceof Error ? err.message : 'Call failed') });
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
              {toNumber.trim() && !toValid && (
                <p className="mt-1 text-[12px] text-red-600">Enter the full number with area code, e.g. +15551234567.</p>
              )}
              {toValid && toE164 !== toNumber.trim() && (
                <p className="mt-1 text-[12px] text-gray-500">Will call {toE164}</p>
              )}
            </div>
            {loading ? (
              <p className="text-[12.5px] text-gray-400">Loading numbers…</p>
            ) : options.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-800">
                <p>This workspace has no phone numbers yet. Add or buy one on the Phone Numbers page, then come back.</p>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[12.5px] font-medium text-gray-500">Call from</label>
                <select value={fromId} onChange={(e) => { setFromId(e.target.value); setMessage(null); }} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[13.5px]">
                  {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                {selected && !selected.ready && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-800">
                    <p className="mb-1.5">{selected.number} is not using V{latestVersion.version_number} as its Outbound Call Agent yet.</p>
                    <button type="button" disabled={busy} onClick={() => { const n = numbers.find((x) => x.id === selected.id); if (n) assign(n); }} className="font-medium underline disabled:opacity-40">
                      Use V{latestVersion.version_number} on {selected.number}
                    </button>
                  </div>
                )}
              </div>
            )}
            {message && <p className={`text-[13px] ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-[13.5px] font-medium text-gray-600 hover:bg-gray-50">Close</button>
              <button onClick={call} disabled={busy || !selected?.ready || !toValid} className="rounded-lg bg-blue-600 px-4 py-2 text-[13.5px] font-medium text-white disabled:opacity-40">
                {busy ? 'Calling…' : 'Call me'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
