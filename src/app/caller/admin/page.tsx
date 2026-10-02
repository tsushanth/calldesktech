'use client';

import { useCallback, useEffect, useState } from 'react';
import { OUTCOMES, OUTCOME_LABELS, type Outcome } from '@/lib/callerPortal';

interface CallerSummary {
  caller: string; batch_size: number; dials: number; answered: number; avg_answered_seconds: number; blocked: number;
  recordings: number; logged: number; wins: number; answered_not_logged: number; outcomes: Record<string, number>;
}
interface AdminRow {
  caller: string; position: number; company: string; phone: string; state: string | null; attempt: number;
  call: { status: string; answered: boolean | null; seconds: number | null; recorded: boolean; blocked: string | null } | null;
  outcome: Outcome | null; notes: string | null; mobile_number: string | null; text_ok: boolean;
}

const pretty = (p: string) => p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [data, setData] = useState<{ date: string; callers: CallerSummary[]; rows: AdminRow[] } | null>(null);
  const [error, setError] = useState('');
  const [who, setWho] = useState('all');

  const load = useCallback(async (k: string, d: string) => {
    const res = await fetch(`/api/caller/admin?k=${encodeURIComponent(k)}${d ? `&date=${d}` : ''}`, { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok) { setError(body.error || 'Could not load.'); return; }
    setError(''); setData(body); setDate(body.date);
  }, []);

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('k');
    // Deferred a tick so state is not set synchronously inside the effect body.
    const start = setTimeout(() => {
      if (!k) { setError('This page needs your private link.'); return; }
      setToken(k);
      load(k, '');
    }, 0);
    const poll = k ? setInterval(() => load(k, ''), 30000) : undefined;
    return () => { clearTimeout(start); if (poll) clearInterval(poll); };
  }, [load]);

  if (error && !data) return <main className="mx-auto max-w-xl p-6 text-gray-700">{error}</main>;
  if (!data) return <main className="mx-auto max-w-xl p-6 text-gray-500">Loading...</main>;
  const rows = data.rows.filter((r) => who === 'all' || r.caller === who);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 text-gray-900">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Caller summary</h1>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); if (token) load(token, e.target.value); }} className="rounded border border-gray-300 px-2 py-1 text-sm" />
        <span className="text-xs text-gray-500">Test calls are not counted.</span>
      </div>

      {data.callers.length === 0 && <p className="text-gray-600">No batches or calls for this date.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {data.callers.map((c) => (
          <section key={c.caller} className="rounded-lg border border-gray-200 p-4">
            <h2 className="font-semibold">{c.caller}</h2>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-gray-500">Batch</dt><dd>{c.batch_size}</dd></div>
              <div><dt className="text-gray-500">Dials</dt><dd>{c.dials}</dd></div>
              <div><dt className="text-gray-500">Answered</dt><dd>{c.answered}{c.dials ? ` (${Math.round((c.answered / c.dials) * 100)}%)` : ''}</dd></div>
              <div><dt className="text-gray-500">Avg answered</dt><dd>{c.avg_answered_seconds}s</dd></div>
              <div><dt className="text-gray-500">Logged</dt><dd>{c.logged}</dd></div>
              <div><dt className="text-gray-500">Wins</dt><dd className="font-semibold text-green-700">{c.wins}</dd></div>
              <div><dt className="text-gray-500">Blocked dials</dt><dd>{c.blocked}</dd></div>
              <div><dt className="text-gray-500">Recordings</dt><dd>{c.recordings}</dd></div>
              <div><dt className="text-gray-500">Answered, not logged</dt><dd className={c.answered_not_logged ? 'font-semibold text-amber-700' : ''}>{c.answered_not_logged}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-gray-600">
              {OUTCOMES.filter((o) => c.outcomes[o]).map((o) => `${OUTCOME_LABELS[o]} ${c.outcomes[o]}`).join(' · ') || 'No outcomes logged yet.'}
            </p>
          </section>
        ))}
      </div>

      <div className="mb-2 mt-6 flex items-center gap-2 text-sm">
        <span className="text-gray-600">Show:</span>
        {['all', ...data.callers.map((c) => c.caller)].map((w) => (
          <button key={w} onClick={() => setWho(w)} className={`rounded-full border px-3 py-1 ${who === w ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600'}`}>{w}</button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr><th className="p-2">Caller</th><th className="p-2">#</th><th className="p-2">Company</th><th className="p-2">Number</th><th className="p-2">Call</th><th className="p-2">Outcome</th><th className="p-2">Notes</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.caller}-${r.phone}`} className="border-t border-gray-100">
                <td className="p-2">{r.caller}</td>
                <td className="p-2">{r.position}{r.attempt > 1 ? ' (retry)' : ''}</td>
                <td className="p-2">{r.company}<span className="ml-1 text-xs text-gray-400">{r.state}</span></td>
                <td className="p-2 whitespace-nowrap">{pretty(r.phone)}</td>
                <td className="p-2 whitespace-nowrap">{r.call ? (r.call.blocked ? `blocked: ${r.call.blocked}` : `${r.call.answered ? 'answered' : r.call.status}${r.call.seconds ? ` ${r.call.seconds}s` : ''}${r.call.recorded ? ' ●' : ''}`) : '-'}</td>
                <td className="p-2">{r.outcome ? OUTCOME_LABELS[r.outcome] : '-'}{r.outcome === 'forward_number_requested' && r.mobile_number ? ` (${pretty(r.mobile_number)}${r.text_ok ? ', ok to text' : ''})` : ''}</td>
                <td className="p-2 text-gray-600">{r.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
