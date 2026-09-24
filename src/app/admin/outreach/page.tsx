'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Lead {
  id: string;
  company_name: string;
  domain: string | null;
  signal_source: string;
  signal_detail: string | null;
  status: string;
  created_at: string;
  score: number | null;
  signals: { reasons: string[]; techPlatforms: string[] } | null;
}

interface BenchmarkAggregate {
  totalRuns: number;
  winRatePct: number | null;
  avgLatencyDeltaMs: number | null;
}

export default function OutreachLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [manualForm, setManualForm] = useState({ companyName: '', domain: '', signalDetail: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [leadsRes, benchmarkRes] = await Promise.all([
      fetch('/api/admin/outreach/leads'),
      fetch('/api/admin/outreach/benchmark-summary'),
    ]);
    if (leadsRes.ok) setLeads((await leadsRes.json()).leads ?? []);
    if (benchmarkRes.ok) setBenchmark((await benchmarkRes.json()).benchmark ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addManualLead = async () => {
    if (!manualForm.companyName.trim()) return;
    await fetch('/api/admin/outreach/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', ...manualForm }),
    });
    setManualForm({ companyName: '', domain: '', signalDetail: '' });
    refresh();
  };

  const scanJobPostings = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/admin/outreach/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'scan_job_postings' }),
      });
      const body = await res.json();
      if (res.ok) refresh();
      else alert(body.error || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {benchmark && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-gray-400">Benchmark evidence on file</p>
          {benchmark.totalRuns === 0 ? (
            <p className="mt-1 text-[13.5px] text-amber-600">
              No mystery-shopper runs imported yet — generated reports will skip comparison numbers until you backfill
              at least one via POST /api/admin/outreach/benchmark-runs.
            </p>
          ) : (
            <p className="mt-1 text-[13.5px] text-gray-600">
              {benchmark.totalRuns} run(s) · win rate {benchmark.winRatePct}% ·{' '}
              {benchmark.avgLatencyDeltaMs !== null
                ? `avg ${Math.abs(Math.round(benchmark.avgLatencyDeltaMs))}ms ${benchmark.avgLatencyDeltaMs > 0 ? 'faster' : 'slower'} than Retell`
                : 'no latency data yet'}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Link href="/admin/outreach/samples" className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
          Sample results
        </Link>
        <Link href="/admin/outreach/queue" className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
          Review queue
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-[12px] font-medium text-gray-500">Company name</label>
          <input
            className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13.5px]"
            value={manualForm.companyName}
            onChange={(e) => setManualForm((f) => ({ ...f, companyName: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-gray-500">Domain (optional)</label>
          <input
            className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13.5px]"
            value={manualForm.domain}
            onChange={(e) => setManualForm((f) => ({ ...f, domain: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-gray-500">Note (optional)</label>
          <input
            className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13.5px]"
            value={manualForm.signalDetail}
            onChange={(e) => setManualForm((f) => ({ ...f, signalDetail: e.target.value }))}
          />
        </div>
        <button
          onClick={addManualLead}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700"
        >
          Add lead
        </button>
        <button
          onClick={scanJobPostings}
          disabled={scanning}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Scan job postings'}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Signal</th>
              <th className="px-4 py-2.5">Score</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No leads yet.
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr key={lead.id} className="border-t border-gray-100">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{lead.company_name}</p>
                  {lead.domain && <p className="text-[12px] text-gray-400">{lead.domain}</p>}
                </td>
                <td className="px-4 py-2.5 text-gray-500">
                  {lead.signal_source}
                  {lead.signal_detail && <p className="text-[12px] text-gray-400">{lead.signal_detail}</p>}
                </td>
                <td className="px-4 py-2.5">
                  {lead.score != null ? (
                    <span title={lead.signals?.reasons?.join('\n') ?? ''} className="cursor-help font-medium">
                      {lead.score}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                  {lead.signals?.techPlatforms?.length ? (
                    <p className="text-[11px] text-gray-400">{lead.signals.techPlatforms.join(', ')}</p>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-medium text-gray-600">
                    {lead.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/admin/outreach/leads/${lead.id}`} className="font-medium text-blue-600 hover:underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
