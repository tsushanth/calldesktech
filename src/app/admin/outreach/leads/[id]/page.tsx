'use client';

import { useEffect, useState, useCallback, use as usePromise } from 'react';
import Link from 'next/link';

interface Lead {
  id: string;
  company_name: string;
  domain: string | null;
  signal_source: string;
  signal_detail: string | null;
  status: string;
  report_html: string | null;
  report_text: string | null;
  report_subject: string | null;
}

export default function OutreachLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/outreach/leads/${id}`);
    if (res.ok) setLead((await res.json()).lead);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const generateReport = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/outreach/leads/${id}/report`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to generate report');
      setLead(body.lead);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const sendPreview = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/outreach/leads/${id}/report`, { method: 'PUT' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to send preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send preview');
    } finally {
      setSending(false);
    }
  };

  const markSent = async () => {
    const res = await fetch(`/api/admin/outreach/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent' }),
    });
    if (res.ok) setLead((await res.json()).lead);
  };

  if (loading) return <p className="text-gray-400">Loading…</p>;
  if (!lead) return <p className="text-gray-400">Lead not found.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/admin/outreach" className="text-[13px] text-blue-600 hover:underline">
        ← All leads
      </Link>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-[16px] font-semibold">{lead.company_name}</h2>
        {lead.domain && <p className="text-[13px] text-gray-400">{lead.domain}</p>}
        <p className="mt-2 text-[13.5px] text-gray-600">
          Signal: {lead.signal_source}
          {lead.signal_detail ? ` — ${lead.signal_detail}` : ''}
        </p>
        <p className="mt-1 text-[12.5px] text-gray-400">Status: {lead.status}</p>
      </div>

      {error && <p className="text-[13.5px] text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={generateReport}
          disabled={generating}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {generating ? 'Generating…' : lead.report_html ? 'Regenerate report' : 'Generate report'}
        </button>
        {lead.report_html && (
          <>
            <button
              onClick={sendPreview}
              disabled={sending}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send preview to myself'}
            </button>
            <button
              onClick={markSent}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
            >
              Mark as sent
            </button>
          </>
        )}
      </div>

      {lead.report_html && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-gray-400">Subject</p>
          <p className="mb-4 text-[14px] font-medium">{lead.report_subject}</p>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-gray-400">Preview</p>
          <div className="rounded-lg border border-gray-100 p-4" dangerouslySetInnerHTML={{ __html: lead.report_html }} />
        </div>
      )}
    </div>
  );
}
