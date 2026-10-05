'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Counts, LaneHealth, ProductRow } from '@/lib/outreach/deliverability';

interface Data {
  generatedAt: string; maxBounce: number;
  caps: Record<string, { sentToday: number; cap: number }>;
  approved: Record<string, number>;
  overall: Counts; products: ProductRow[]; lanes: LaneHealth[];
}

const pct = (r: number | null) => (r === null ? '-' : `${(100 * r).toFixed(1)}%`);
const LANE_LABEL: Record<string, string> = { calldesk: 'Calldesk (all verticals + agencies)', kk: 'Kreative Koala apps', readaloud: 'ReadAloud API' };
const STATE_STYLE: Record<string, string> = {
  ok: 'bg-green-50 text-green-700 border-green-200', watch: 'bg-amber-50 text-amber-800 border-amber-200',
  paused: 'bg-red-50 text-red-700 border-red-200', idle: 'bg-gray-50 text-gray-600 border-gray-200',
};
const rateClass = (r: number | null, max: number) => (r === null ? '' : r >= max ? 'font-semibold text-red-600' : r >= max / 2 ? 'font-semibold text-amber-700' : '');

export default function DeliverabilityPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/outreach/deliverability');
      if (!res.ok) throw new Error(res.status === 401 ? 'Not authorized' : 'Could not load');
      setData(await res.json()); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 120_000);
    return () => clearInterval(t);
  }, [refresh]);

  const th = 'px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-gray-500';
  const td = 'px-3 py-2 text-[13px] tabular-nums';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/outreach" className="text-[13px] text-blue-600 hover:underline">&larr; All leads</Link>
        <Link href="/admin/outreach/queue" className="text-[13px] text-blue-600 hover:underline">Queue</Link>
        <h2 className="text-[15px] font-semibold">Deliverability</h2>
        <button onClick={refresh} className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50">{loading ? 'Loading...' : 'Refresh'}</button>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
      {data && (
        <>
          <p className="text-[12px] text-gray-500">
            Hard bounce rate = permanent bounces / sends over the last 7 days. Transient bounces are shown but do not count. Autosend pauses a lane at {pct(data.maxBounce)} (needs at least 20 sends in 7 days) or on any spam complaint. Updated {new Date(data.generatedAt).toLocaleTimeString()}.
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Sent (all time)', data.overall.sentAll], ['Sent, last 24h', data.overall.sent24h], ['Sent, last 7 days', data.overall.sent7d],
              ['Hard bounce rate (7d)', pct(data.overall.bounceRate7d)],
            ].map(([label, v]) => (
              <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-[12px] text-gray-500">{label}</p>
                <p className="text-[22px] font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {data.lanes.map((l) => (
              <div key={l.lane} className={`rounded-lg border p-3 ${STATE_STYLE[l.state]}`}>
                <p className="text-[12px] font-semibold uppercase tracking-wide">{LANE_LABEL[l.lane]}</p>
                <p className="mt-1 text-[15px] font-semibold">{l.state === 'ok' ? 'Sending' : l.state === 'paused' ? 'Auto-paused' : l.state === 'watch' ? 'Watch' : 'No sends in 7d'}</p>
                <p className="text-[12px]">7d: {l.sent7d} sent, {l.hardBounced7d} hard / {l.softBounced7d} soft bounces, {l.complained7d} complaints, rate {pct(l.bounceRate7d)}</p>
                <p className="text-[12px]">Today: {data.caps[l.lane]?.sentToday ?? 0} of {data.caps[l.lane]?.cap ?? '-'} daily cap</p>
                {l.reason && <p className="mt-1 text-[12px] font-medium">{l.reason}</p>}
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className={th}>Product</th><th className={th}>Sent 24h</th><th className={th}>Sent 7d</th><th className={th}>Delivered 7d</th>
                  <th className={th}>Hard bounce 7d</th><th className={th}>Soft 7d</th><th className={th}>Complaints 7d</th><th className={th}>Bounce rate 7d</th>
                  <th className={th}>All time</th><th className={th}>Bounced all time</th><th className={th}>Approved queue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.products.map((p) => (
                  <tr key={p.product}>
                    <td className={`${td} font-medium`}>{p.product}</td>
                    <td className={td}>{p.sent24h}</td><td className={td}>{p.sent7d}</td><td className={td}>{p.delivered7d}</td>
                    <td className={td}>{p.hardBounced7d}</td><td className={td}>{p.softBounced7d}</td><td className={td}>{p.complained7d}</td>
                    <td className={`${td} ${rateClass(p.bounceRate7d, data.maxBounce)}`}>{pct(p.bounceRate7d)}</td>
                    <td className={td}>{p.sentAll}</td><td className={td}>{p.hardBouncedAll}</td><td className={td}>{data.approved[p.product] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
