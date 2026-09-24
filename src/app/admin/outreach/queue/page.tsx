'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Message {
  id: string;
  to_email: string;
  subject: string;
  body_text: string;
  status: string;
  error: string | null;
  step: number;
  sources?: string[];
  translation_subject?: string | null;
  translation_body?: string | null;
  lead: { company_name: string; domain: string | null; score: number | null; tier: string | null; contact_source_url: string | null; replied_at: string | null } | null;
}

const TABS = ['draft', 'approved', 'sent', 'failed'] as const;
const PRODUCTS = [
  { key: 'calldesk', label: 'Calldesk' },
  { key: 'kreativekoala:voxkey', label: 'VoxKey' },
  { key: 'kreativekoala:pixora', label: 'Pixora' },
  { key: 'kreativekoala:gymlog', label: 'GymLog' },
  { key: 'kreativekoala:simplyapply', label: 'SimplyApply' },
  { key: 'kreativekoala:scribeai', label: 'Scribe AI' },
  { key: 'kreativekoala:meetingmind', label: 'Meeting Mind' },
  { key: 'kreativekoala:vibebuild', label: 'VibeBuild' },
] as const;

export default function OutreachQueuePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('draft');
  const [product, setProduct] = useState<string>('calldesk');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [quota, setQuota] = useState<{ sentToday: number; cap: number; resets: string } | null>(null);
  const [sampleTitle, setSampleTitle] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; body_text: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/outreach/messages?status=${tab}&product=${encodeURIComponent(product)}`);
    if (res.ok) {
      const body = await res.json();
      setMessages(body.messages ?? []);
      setSampleTitle(typeof body.sampleTitle === 'string' ? body.sampleTitle : null);
      setQuota({ sentToday: body.sentToday, cap: body.cap, resets: body.resets });
    }
    setLoading(false);
  }, [tab, product]);

  useEffect(() => {
    // Fetch-on-mount/tab-change, not a render-loop risk (refresh only re-runs when tab/product change).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const act = async (id: string, fn: () => Promise<Response>, okText: string) => {
    setBusy(id);
    setNotice(null);
    const res = await fn();
    const body = await res.json().catch(() => ({}));
    setNotice({ ok: res.ok, text: res.ok ? okText : body.error || 'Something went wrong' });
    setBusy(null);
    refresh();
  };

  const patch = (id: string, payload: object) =>
    fetch(`/api/admin/outreach/messages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/outreach" className="text-[13px] text-blue-600 hover:underline">← All leads</Link>
        <select
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          className="rounded-lg border border-gray-300 px-2 py-1 text-[13px]"
        >
          {PRODUCTS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1 text-[13px] font-medium ${tab === t ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {quota && (
        <p className="rounded-lg px-4 py-2 text-[13.5px] border border-gray-200 bg-white text-gray-700">
          Sent today: {quota.sentToday} (no daily cap).
        </p>
      )}
      {notice && (
        <p className={`rounded-lg px-4 py-2 text-[13.5px] border ${notice.ok ? 'border-gray-200 bg-white text-gray-700' : 'border-red-300 bg-red-50 text-red-700'}`}>{notice.text}</p>
      )}
      {loading && <p className="text-gray-400">Loading…</p>}
      {!loading && messages.length === 0 && <p className="text-gray-400">Nothing in {tab}.</p>}

      {messages.map((m) => {
        const draft = edits[m.id] ?? { subject: m.subject, body_text: m.body_text };
        const editable = m.status === 'draft';
        return (
          <div key={m.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div>
                <p className="text-[14px] font-semibold">
                  {m.lead?.company_name ?? 'Unknown'}
                  {m.step > 1 && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">follow-up #{m.step - 1}</span>}
                  {m.lead?.replied_at && <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">replied</span>}
                  {m.status === 'draft' && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${sampleTitle ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {sampleTitle ? `Sample: ${sampleTitle} (A/B)` : 'No sample for this vertical'}
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-gray-400">
                  {m.to_email}
                  {m.lead?.domain ? ` · ${m.lead.domain}` : ''}
                  {m.lead?.score != null ? ` · score ${m.lead.score}` : ''}
                  {m.lead?.contact_source_url ? (
                    <>
                      {' · '}
                      <a href={m.lead.contact_source_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">email found here</a>
                    </>
                  ) : null}
                </p>
              </div>
            </div>

            <input
              disabled={!editable}
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-[13.5px] disabled:bg-gray-50"
              value={draft.subject}
              onChange={(e) => setEdits((s) => ({ ...s, [m.id]: { ...draft, subject: e.target.value } }))}
            />
            <textarea
              disabled={!editable}
              rows={9}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] leading-relaxed disabled:bg-gray-50"
              value={draft.body_text}
              onChange={(e) => setEdits((s) => ({ ...s, [m.id]: { ...draft, body_text: e.target.value } }))}
            />
            {m.translation_subject && m.translation_body && (
              <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-blue-700">English translation (for review only — not sent)</p>
                <p className="text-[13px] font-medium text-gray-800">{m.translation_subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700">{m.translation_body}</p>
              </div>
            )}
            {m.sources && m.sources.length > 0 && (
              <p className="mt-2 text-[12px] text-gray-400">
                Based on:{' '}
                {m.sources.map((u, i) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    {i > 0 ? ', ' : ''}{u.replace(/^https?:\/\//, '').slice(0, 48)}
                  </a>
                ))}
              </p>
            )}
            {m.error && <p className="mt-2 text-[12.5px] text-red-600">{m.error}</p>}

            <div className="mt-3 flex flex-wrap gap-2">
              {m.status === 'draft' && (
                <>
                  <button
                    disabled={busy === m.id}
                    onClick={() =>
                      act(m.id, async () => {
                        const saved = await patch(m.id, { action: 'edit', ...draft });
                        return saved.ok ? fetch(`/api/admin/outreach/messages/${m.id}`, { method: 'POST' }) : saved;
                      }, 'Sent.')
                    }
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Send now
                  </button>
                  <button
                    disabled={busy === m.id}
                    onClick={() =>
                      act(m.id, async () => {
                        const saved = await patch(m.id, { action: 'edit', ...draft });
                        return saved.ok ? patch(m.id, { action: 'approve' }) : saved;
                      }, 'Approved. Open the "approved" tab to send.')
                    }
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy === m.id}
                    onClick={() => act(m.id, () => patch(m.id, { action: 'reject' }), 'Rejected.')}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              )}
              {m.status === 'approved' && (
                <button
                  disabled={busy === m.id}
                  onClick={() =>
                    act(m.id, () => fetch(`/api/admin/outreach/messages/${m.id}`, { method: 'POST' }), 'Sent.')
                  }
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Send now
                </button>
              )}
              {m.status === 'sent' && !m.lead?.replied_at && (
                <button
                  disabled={busy === m.id}
                  onClick={() => act(m.id, () => patch(m.id, { action: 'mark_replied' }), 'Marked as replied — no more follow-ups will be drafted for this lead.')}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Mark as replied (stop follow-ups)
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
