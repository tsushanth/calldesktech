'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Row {
  product: string; variant: 'plain' | 'sample'; sent: number; viewed: number; played: number;
  completed: number; viewRate: number | null; replies: number; replyRate: number | null;
}

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);

export default function SampleStatsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    fetch('/api/admin/outreach/samples/stats')
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const body = await r.json();
        setRows(body.stats ?? []);
        setTruncated(body.truncated === true);
      })
      .catch((e) => setError(`Could not load stats (${e.message})`));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Sample-call results</h2>
        <Link href="/admin/outreach" className="text-[13px] text-blue-600 hover:underline">Back to leads</Link>
      </div>
      <p className="text-[13px] text-gray-600">
        Sent emails only. &quot;plain&quot; = no sample link, &quot;sample&quot; = email links to the recording page.
        Views/plays are counted once per email, bots and link scanners excluded. Plain emails have no page to view, so their view columns stay at zero.
        With ~10 sends per vertical this is directional, not statistical. A single reply moves a rate by 10 points.
        Replies are recorded on the lead, so a lead that replied counts as a reply for each of its messages. Only messages sent after the experiment started (those assigned a variant) appear.
      </p>
      {truncated && <p className="text-[13px] text-amber-700">Results are truncated (query row limit reached); counts below are incomplete.</p>}
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      {!rows && !error && <p className="text-[13px] text-gray-500">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-[13px] text-gray-500">No sent messages yet (or the sample migration has not been applied).</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-gray-200 text-[12px] uppercase tracking-wider text-gray-400">
              <tr>
                {['Product', 'Variant', 'Sent', 'Viewed', 'Played', 'Completed', 'View rate', 'Replies', 'Reply rate'].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.product}|${r.variant}`} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 font-medium">{r.product}</td>
                  <td className="px-3 py-2">{r.variant}</td>
                  <td className="px-3 py-2">{r.sent}</td>
                  <td className="px-3 py-2">{r.viewed}</td>
                  <td className="px-3 py-2">{r.played}</td>
                  <td className="px-3 py-2">{r.completed}</td>
                  <td className="px-3 py-2">{pct(r.viewRate)}</td>
                  <td className="px-3 py-2">{r.replies}</td>
                  <td className="px-3 py-2">{pct(r.replyRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
