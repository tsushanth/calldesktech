'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[14px] focus:border-[#00122e] focus:outline-none';
const btn = 'rounded-md px-3 py-1.5 text-[13px] font-medium ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-50';

async function call(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const j = await res.json().catch(() => ({}));
  return j.error || `Request failed (${res.status})`;
}

export function CreatePilotForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries());
    setBusy(true);
    setErr(null);
    const msg = await call('/api/admin/pilots', 'POST', f);
    setBusy(false);
    if (msg) return setErr(msg);
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button className="rounded-md bg-[#00122e] px-4 py-2 text-[14px] font-medium text-white" onClick={() => setOpen(true)}>New pilot</button>;
  return (
    <form onSubmit={submit} className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-[15px] font-medium">New pilot</h2>
      <p className="mt-1 text-[13px] text-gray-500">Starts now and runs one week with a 50 minute cap unless you change it. Give the workspace id, or the email the prospect signed in with.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-[13px]">Workspace id<input name="tenant_id" className={input} placeholder="uuid" /></label>
        <label className="text-[13px]">or owner email<input name="owner_email" type="email" className={input} /></label>
        <label className="text-[13px]">Company<input name="company" className={input} /></label>
        <label className="text-[13px]">Vertical<input name="vertical" className={input} placeholder="dental, hvac, ..." /></label>
        <label className="text-[13px]">Contact name<input name="contact_name" className={input} /></label>
        <label className="text-[13px]">Contact email<input name="contact_email" type="email" className={input} /></label>
        <label className="text-[13px]">Minutes cap<input name="minutes_cap" type="number" min="1" defaultValue={50} className={input} /></label>
        <label className="text-[13px]">Days<input name="days" type="number" min="1" defaultValue={7} className={input} /></label>
      </div>
      <label className="mt-3 block text-[13px]">Notes<textarea name="notes" rows={2} className={input} /></label>
      {err && <p role="alert" className="mt-3 text-[13px] text-red-600">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button disabled={busy} className="rounded-md bg-[#00122e] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50">{busy ? 'Creating...' : 'Create pilot'}</button>
        <button type="button" className={btn} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function PilotActionButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setErr(null);
    const msg = await call(`/api/admin/pilots/${id}`, 'PATCH', body);
    setBusy(false);
    if (msg) return setErr(msg);
    router.refresh();
  }
  const closed = status === 'converted';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={busy} className={btn} onClick={() => run({ action: 'extend', days: 7 })}>Extend 7 days</button>
      <button disabled={busy} className={btn} onClick={() => run({ action: 'extend', minutes: 25 })}>Add 25 min</button>
      {!closed && <button disabled={busy} className={btn} onClick={() => run({ action: 'convert' }, 'Mark this pilot as converted? The agent keeps answering.')}>Mark converted</button>}
      {status !== 'stopped' && !closed && <button disabled={busy} className={`${btn} text-red-700`} onClick={() => run({ action: 'stop' }, 'Stop this pilot? The agent will stop answering their calls.')}>Stop</button>}
      {err && <span role="alert" className="text-[13px] text-red-600">{err}</span>}
    </div>
  );
}
