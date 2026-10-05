'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function TryForm({ token, copy, consentVersion, consentSha256 }: { token: string; copy: { phoneLabel: string; consentLabel: string; optionalNote: string; submitLabel: string }; consentVersion: string; consentSha256: string }) {
  const [phone, setPhone] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot, hidden from people
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ coupon: string | null; smsOptIn: boolean; suppressed: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/try', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token, phone, smsOptIn: optIn, website, consentVersion, consentSha256 }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      setDone({ coupon: data.coupon ?? null, smsOptIn: !!data.smsOptIn, suppressed: !!data.suppressed });
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.'); }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-2 text-xl font-semibold">Your trial coupon</h2>
        {done.coupon ? (
          <>
            <p className="my-3 rounded-lg bg-neutral-100 px-4 py-3 text-center font-mono text-2xl font-semibold tracking-wider">{done.coupon}</p>
            <p className="text-sm text-neutral-600">$10 off your first Calldesk invoice. Single use, valid for 30 days. Enter it at checkout (a card is required to subscribe). The free two-week pilot is separate and needs no card.</p>
          </>
        ) : (
          <p className="text-sm text-neutral-600">We could not generate the coupon right now. Reply to our email and we will send one by hand.</p>
        )}
        {done.smsOptIn && !done.suppressed && <p className="mt-4 text-sm text-neutral-600">Thanks. We have saved your text-message preference. Reply STOP to any text to opt out.</p>}
        {done.suppressed && <p className="mt-4 text-sm text-neutral-600">You previously opted out of our texts, so we have not subscribed this number. To resubscribe, text START to one of the numbers on our <a className="text-blue-600 underline" href="/sms">SMS page</a>.</p>}
        <p className="mt-4 text-sm"><Link className="text-blue-600 underline" href="/demo">Try the free demo</Link></p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-neutral-200 bg-white p-6">
      <label className="mb-1 block text-sm font-medium" htmlFor="phone">{copy.phoneLabel}</label>
      <input id="phone" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
        placeholder="(415) 555-0123" className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2" />
      <div style={{ position: 'absolute', left: '-10000px', height: 0, overflow: 'hidden' }} aria-hidden="true">
        <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      <label className="mb-4 flex items-start gap-3 text-sm text-neutral-700">
        <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-1 h-4 w-4" />
        <span>
          {copy.consentLabel} See our <a className="text-blue-600 underline" href="/privacy">Privacy Policy</a> and <a className="text-blue-600 underline" href="/terms">Terms</a>.
        </span>
      </label>
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">{busy ? 'Getting your coupon...' : copy.submitLabel}</button>
      <p className="mt-3 text-xs text-neutral-500">{copy.optionalNote}</p>
    </form>
  );
}
