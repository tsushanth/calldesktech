'use client';

import { useState } from 'react';

export default function HearForm({ consentText, version, sha256 }: { consentText: string; version: string; sha256: string }) {
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot, hidden from people
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/hear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, businessName, consent, website, shownVersion: version, shownSha256: sha256 }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.'); }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-2 text-xl font-semibold">Your phone is about to ring</h2>
        <p className="text-sm text-neutral-600">Pick up in the next few seconds. If it does not ring within a minute, check the number and try again tomorrow.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="rounded-xl border border-neutral-200 bg-white p-6">
      <label className="mb-1 block text-sm font-medium" htmlFor="phone">Your phone number</label>
      <input id="phone" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(415) 555-0123" className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2" />
      <label className="mb-1 block text-sm font-medium" htmlFor="biz">Your business name (optional)</label>
      <input id="biz" type="text" maxLength={60} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Joe's Plumbing" className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2" />
      <div style={{ position: 'absolute', left: '-10000px', height: 0, overflow: 'hidden' }} aria-hidden="true">
        <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      <label className="mb-4 flex items-start gap-3 text-sm text-neutral-700">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />
        <span>{consentText}</span>
      </label>
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">{busy ? 'Calling...' : 'Call me'}</button>
    </form>
  );
}
