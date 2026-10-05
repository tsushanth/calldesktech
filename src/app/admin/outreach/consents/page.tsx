'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Consent { created_at: string; phone: string; sms_opt_in: boolean; sms_status: string; consent_version: string | null; product: string | null; coupon_code: string | null }

export default function ConsentsPage() {
  const [rows, setRows] = useState<Consent[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/admin/outreach/consents').then((r) => r.json()).then((d) => { setRows(d.consents ?? []); setNote(d.note ?? null); }).catch(() => setNote('Could not load'));
  }, []);
  const optIns = rows?.filter((r) => r.sms_opt_in).length ?? 0;
  const th = 'px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-gray-500';
  const td = 'px-3 py-2 text-[13px]';
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/outreach" className="text-[13px] text-blue-600 hover:underline">&larr; All leads</Link>
        <h2 className="text-[15px] font-semibold">SMS consents</h2>
        <a href="/api/admin/outreach/consents?format=csv" className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50">Download CSV (proof file)</a>
      </div>
      <p className="text-[12px] text-gray-500">Collected on /try from outreach emails. &quot;pending_campaign&quot; means the person opted in but no marketing text may be sent until a marketing 10DLC campaign is approved. Nothing is texted from this page.</p>
      {note && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{note}</p>}
      {rows && <p className="text-[13px]">{rows.length} submissions, {optIns} opted in to texts.</p>}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50"><tr><th className={th}>When</th><th className={th}>Phone</th><th className={th}>Opted in</th><th className={th}>Status</th><th className={th}>Wording</th><th className={th}>Product</th><th className={th}>Coupon</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(rows ?? []).map((r, i) => (
              <tr key={i}><td className={td}>{new Date(r.created_at).toLocaleString()}</td><td className={td}>{r.phone}</td><td className={td}>{r.sms_opt_in ? 'yes' : 'no'}</td><td className={td}>{r.sms_status}</td><td className={td}>{r.consent_version ?? '-'}</td><td className={td}>{r.product ?? '-'}</td><td className={td}>{r.coupon_code ?? '-'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
