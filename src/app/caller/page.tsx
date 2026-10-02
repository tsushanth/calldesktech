'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { OUTCOMES, OUTCOME_LABELS, type Outcome } from '@/lib/callerPortal';

interface Row {
  id: string;
  phone: string;
  company_name: string;
  state: string | null;
  position: number;
  attempt: number;
  local_time: string | null;
  can_call_now: boolean;
  hours_reason: string | null;
  last_call: { status: string; answered: boolean | null; seconds: number | null; blocked: string | null } | null;
  outcome: Outcome | null;
  notes: string | null;
  mobile_number: string | null;
  text_ok: boolean;
}
interface Data {
  caller: { username: string; name: string; role: string };
  date: string;
  summary: { total: number; dialed: number; logged: number; wins: number };
  rows: Row[];
}
interface Draft { outcome: string; notes: string; mobile: string; textOk: boolean }

const pretty = (e164: string) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
const HOURS_WHY: Record<string, string> = {
  too_early: 'Too early there',
  too_late: 'Too late there',
  weekend: 'Weekend',
  unknown_state: 'Unknown state',
};

function callLabel(c: Row['last_call']): { text: string; tone: string } | null {
  if (!c) return null;
  if (c.blocked) return { text: `Blocked: ${c.blocked.replace(/_/g, ' ')}`, tone: 'bg-red-50 text-red-700' };
  if (c.answered) return { text: `Answered${c.seconds ? ` ${Math.floor(c.seconds / 60)}:${String(c.seconds % 60).padStart(2, '0')}` : ''}`, tone: 'bg-green-50 text-green-700' };
  const labels: Record<string, string> = { 'no-answer': 'No answer', busy: 'Busy', failed: 'Failed', canceled: 'Canceled', initiated: 'Dialing...', completed: 'Completed' };
  return { text: labels[c.status] ?? c.status, tone: 'bg-gray-100 text-gray-700' };
}

export default function CallerPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<'todo' | 'done' | 'all'>('todo');

  const load = useCallback(async (k: string) => {
    try {
      const res = await fetch(`/api/caller/batch?k=${encodeURIComponent(k)}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not load.'); return; }
      setError('');
      setData(body);
    } catch { setError('Connection problem. It will retry.'); }
  }, []);

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('k');
    // Deferred a tick so state is not set synchronously inside the effect body.
    const start = setTimeout(() => {
      if (!k) { setError('This page needs your private link.'); return; }
      setToken(k);
      load(k);
    }, 0);
    const poll = k ? setInterval(() => load(k), 20000) : undefined;
    return () => { clearTimeout(start); if (poll) clearInterval(poll); };
  }, [load]);

  const draftOf = (r: Row): Draft =>
    drafts[r.id] ?? { outcome: r.outcome ?? '', notes: r.notes ?? '', mobile: r.mobile_number ? pretty(r.mobile_number) : '', textOk: r.text_ok };
  const setDraft = (r: Row, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [r.id]: { ...draftOf(r), ...patch } }));

  async function save(r: Row) {
    if (!token) return;
    const d = draftOf(r);
    setSaving(r.id);
    setRowError((e) => ({ ...e, [r.id]: '' }));
    try {
      const res = await fetch('/api/caller/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: token, id: r.id, outcome: d.outcome, notes: d.notes, mobile_number: d.mobile, text_ok: d.textOk }),
      });
      const body = await res.json();
      if (!res.ok) { setRowError((e) => ({ ...e, [r.id]: body.error || 'Could not save.' })); return; }
      setDrafts((all) => { const n = { ...all }; delete n[r.id]; return n; });
      await load(token);
    } finally { setSaving(null); }
  }

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return filter === 'all' ? all : all.filter((r) => (filter === 'done' ? !!r.outcome : !r.outcome));
  }, [data, filter]);

  if (error && !data) return <main className="mx-auto max-w-xl p-6 text-gray-700">{error}</main>;
  if (!data) return <main className="mx-auto max-w-xl p-6 text-gray-500">Loading...</main>;

  const s = data.summary;
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-gray-900">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Hi {data.caller.name.split(' ')[0]}, your calls for {data.date}</h1>
        <p className="mt-1 text-sm text-gray-600">
          Logged {s.logged} of {s.total} &middot; Dialed {s.dialed} &middot; Wins {s.wins}
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200">
          <div className="h-2 bg-blue-600" style={{ width: `${s.total ? (s.logged / s.total) * 100 : 0}%` }} />
        </div>
        {error && <p className="mt-2 text-sm text-amber-700">{error}</p>}
        <div className="mt-3 flex gap-2 text-sm">
          {(['todo', 'done', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 ${filter === f ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600'}`}>
              {f === 'todo' ? 'To do' : f === 'done' ? 'Done' : 'All'}
            </button>
          ))}
        </div>
      </header>

      {data.rows.length === 0 && <p className="rounded border border-gray-200 p-4 text-gray-600">No numbers in your batch for today yet.</p>}

      <ul className="space-y-3">
        {rows.map((r) => {
          const d = draftOf(r);
          const label = callLabel(r.last_call);
          return (
            <li key={r.id} className={`rounded-lg border p-3 ${r.outcome ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{r.position}. {r.company_name}{r.attempt > 1 && <span className="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-xs text-purple-700">retry</span>}</p>
                  <p className="mt-0.5 text-lg tracking-wide">
                    {pretty(r.phone)}
                    <button className="ml-3 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600" onClick={() => navigator.clipboard?.writeText(r.phone.replace(/^\+1/, ''))}>Copy</button>
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">{r.state} {r.local_time ?? ''}</span>
                  <span className={`rounded px-2 py-1 ${r.can_call_now ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {r.can_call_now ? 'OK to call now' : HOURS_WHY[r.hours_reason ?? ''] ?? 'Do not call now'}
                  </span>
                  {label && <span className={`rounded px-2 py-1 ${label.tone}`}>{label.text}</span>}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-[14rem_1fr_auto]">
                <select value={d.outcome} onChange={(e) => setDraft(r, { outcome: e.target.value })} className="rounded border border-gray-300 px-2 py-2 text-sm">
                  <option value="">Choose an outcome...</option>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
                </select>
                <input value={d.notes} onChange={(e) => setDraft(r, { notes: e.target.value })} placeholder={d.outcome === 'callback_requested' ? 'Callback time (required)' : 'Notes (optional)'} className="rounded border border-gray-300 px-2 py-2 text-sm" />
                <button onClick={() => save(r)} disabled={!d.outcome || saving === r.id} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                  {saving === r.id ? 'Saving...' : r.outcome ? 'Update' : 'Save'}
                </button>
              </div>
              {d.outcome === 'forward_number_requested' && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <input value={d.mobile} onChange={(e) => setDraft(r, { mobile: e.target.value })} placeholder="Their mobile number" className="rounded border border-gray-300 px-2 py-2" />
                  <label className="flex items-center gap-2"><input type="checkbox" checked={d.textOk} onChange={(e) => setDraft(r, { textOk: e.target.checked })} /> They agreed to a text</label>
                </div>
              )}
              {d.outcome === 'do_not_call' && <p className="mt-2 text-xs text-gray-500">This number will be blocked for everyone.</p>}
              {rowError[r.id] && <p className="mt-2 text-sm text-red-600">{rowError[r.id]}</p>}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
