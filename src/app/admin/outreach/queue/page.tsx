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
  product?: string | null;
  lead: { company_name: string; domain: string | null; score: number | null; tier: string | null; contact_source_url: string | null; replied_at: string | null } | null;
}

const TABS = ['draft', 'approved', 'sent', 'failed', 'forms'] as const;
const PRODUCTS = [
  { key: 'calldesk', label: 'Calldesk' },
  { key: 'kreativekoala:voxkey', label: 'VoxKey' },
  { key: 'kreativekoala:pixora', label: 'Pixora' },
  { key: 'kreativekoala:gymlog', label: 'GymLog' },
  { key: 'kreativekoala:simplyapply', label: 'SimplyApply' },
  { key: 'kreativekoala:scribeai', label: 'Scribe AI' },
  { key: 'kreativekoala:meetingmind', label: 'Meeting Mind' },
  { key: 'kreativekoala:vibebuild', label: 'VibeBuild' },
  { key: 'readaloud', label: 'ReadAloud API' },
] as const;

// Verticals live under the Calldesk product; they are a filter and a badge, not separate products.
const VERTICALS = [
  { key: '', label: 'All verticals' },
  { key: 'freight', label: 'Freight brokers' },
  { key: 'homeservices', label: 'Home services' },
  { key: 'dental', label: 'Dental' },
  { key: 'insurance', label: 'Insurance agencies' },
  { key: 'towing', label: 'Towing' },
  { key: 'septic', label: 'Septic' },
  { key: 'homecare', label: 'Home care' },
  { key: 'bailbonds', label: 'Bail bonds' },
  { key: 'childcare', label: 'Child care' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'realestate', label: 'Real estate' },
  { key: 'lodging', label: 'Guesthouses & campgrounds' },
  { key: 'funeral', label: 'Funeral homes' },
  { key: 'physio', label: 'Physio & chiropractic' },
  { key: 'taxi', label: 'Taxi & private hire' },
  { key: 'vets', label: 'Veterinary' },
] as const;
const verticalLabel = (product?: string | null) => VERTICALS.find((v) => v.key && product === `calldesk:${v.key}`)?.label ?? null;

interface FormLead {
  id: string;
  company_name: string;
  domain: string | null;
  location: string | null;
  score: number | null;
  product: string;
  signals: {
    contactForm?: { pageUrl: string; captcha: boolean; method: string; embedded?: string };
    formOutreach?: {
      subject: string;
      body: string;
      status: string;
      reason?: string;
      error?: string;
      submittedAt?: string;
      attempts?: { at: string; outcome: string; reason?: string; screenshot?: string }[];
    };
  } | null;
}

// Status filters for the forms tab. 'submitting' is the worker's in-flight lock and shows up
// under "queued" activity rather than as its own tab.
const FORM_STATUSES = ['ready', 'queued', 'needs_manual', 'failed', 'submitted', 'replied', 'skipped'] as const;
const FORM_STATUS_LABELS: Record<(typeof FORM_STATUSES)[number], string> = {
  ready: 'ready',
  queued: 'queued',
  needs_manual: 'needs manual',
  failed: 'failed',
  submitted: 'submitted',
  replied: 'replied',
  skipped: 'skipped',
};

const SUBMIT_CONFIRM = "This will fill and submit the practice's contact form with this message.";

export default function OutreachQueuePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('draft');
  const [product, setProduct] = useState<string>('calldesk');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [quota, setQuota] = useState<{ sentToday: number; cap: number; resets: string } | null>(null);
  const [vertical, setVertical] = useState<string>('');
  const [sampleTitles, setSampleTitles] = useState<Record<string, string | null>>({});
  const [sampleTitle, setSampleTitle] = useState<string | null>(null);
  const [formLeads, setFormLeads] = useState<FormLead[]>([]);
  const [formStatus, setFormStatus] = useState<(typeof FORM_STATUSES)[number]>('ready');
  const [formCounts, setFormCounts] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{ subject: string; to: string; html: string; variant: string | null } | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; body_text: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    if (tab === 'forms') {
      const fr = await fetch(`/api/admin/outreach/forms?status=${formStatus}${vertical ? `&vertical=${vertical}` : ''}`);
      if (fr.ok) {
        const fb = await fr.json();
        setFormLeads(fb.leads ?? []);
        setFormCounts(fb.counts ?? {});
      }
      setLoading(false);
      return;
    }
    const res = await fetch(`/api/admin/outreach/messages?status=${tab}&product=${encodeURIComponent(product)}${product === 'calldesk' && vertical ? `&vertical=${vertical}` : ''}`);
    if (res.ok) {
      const body = await res.json();
      setMessages(body.messages ?? []);
      setSampleTitle(typeof body.sampleTitle === 'string' ? body.sampleTitle : null);
      setSampleTitles(body.sampleTitles ?? {});
      setQuota({ sentToday: body.sentToday, cap: body.cap, resets: body.resets });
    }
    setLoading(false);
  }, [tab, product, vertical, formStatus]);

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

  const openPreview = async (m: Message, draft: { subject: string; body_text: string }) => {
    setBusy(m.id);
    setNotice(null);
    if (m.status === 'draft') {
      const saved = await patch(m.id, { action: 'edit', ...draft });
      if (!saved.ok) {
        setNotice({ ok: false, text: 'Could not save the draft before previewing' });
        setBusy(null);
        return;
      }
    }
    const res = await fetch(`/api/admin/outreach/messages/${m.id}/preview`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) setPreview(body);
    else setNotice({ ok: false, text: body.error || 'Preview failed' });
    setBusy(null);
  };

  const patchForm = async (id: string, payload: object, okText: string) => {
    setBusy(id);
    const res = await fetch('/api/admin/outreach/forms', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...payload }) });
    const body = await res.json().catch(() => ({}));
    setNotice({ ok: res.ok, text: res.ok ? okText : body.error || 'Could not update' });
    setBusy(null);
    refresh();
  };

  const markForm = (id: string, status: string) => patchForm(id, { status }, `Marked ${status}.`);

  // The ONLY way a lead reaches the worker. The confirm dialog is deliberate: this
  // sends a real message to a real practice through their own form.
  const submitForMe = (id: string) => {
    if (!window.confirm(SUBMIT_CONFIRM)) return;
    return patchForm(id, { action: 'queue' }, 'Queued. The form worker will submit it on its next pass.');
  };

  const retryForm = (id: string) => {
    if (!window.confirm(SUBMIT_CONFIRM)) return;
    return patchForm(id, { action: 'retry' }, 'Re-queued for another attempt.');
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
        {(product === 'calldesk' || tab === 'forms') && (
          <select
            value={vertical}
            onChange={(e) => setVertical(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-[13px]"
          >
            {VERTICALS.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
        )}
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

      {tab === 'forms' && (
        <div className="flex flex-wrap gap-1">
          {FORM_STATUSES.map((st) => (
            <button key={st} onClick={() => setFormStatus(st)} className={`rounded-lg px-3 py-1 text-[12.5px] font-medium ${formStatus === st ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}>
              {FORM_STATUS_LABELS[st]}
              {formCounts[st] ? <span className="ml-1 text-gray-400">{formCounts[st]}</span> : null}
            </button>
          ))}
        </div>
      )}
      {tab === 'forms' && (
        <>
          <p className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] text-gray-700">
            Submitted today: {formCounts.submittedToday ?? 0} · needs manual: {formCounts.needs_manual ?? 0} · queued: {formCounts.queued ?? 0}
            {formCounts.submitting ? ` · in flight: ${formCounts.submitting}` : ''}
            {formCounts.failed ? ` · failed: ${formCounts.failed}` : ''}
          </p>
          <p className="text-[13px] text-gray-500">
            Practices with no public email. <strong>Submit for me</strong> hands one lead to the form worker on the mini, which fills and
            submits that practice&apos;s own form once. Nothing is submitted until you click it. Anything with a captcha, an unrecognised
            form, or an unconfirmed result lands in <em>needs manual</em> for you to finish by hand.
          </p>
        </>
      )}
      {tab === 'forms' && !loading && formLeads.length === 0 && <p className="text-gray-400">No form leads in {formStatus}.</p>}
      {tab === 'forms' && formLeads.map((l) => {
        const fo = l.signals?.formOutreach;
        const cf = l.signals?.contactForm;
        if (!fo || !cf) return null;
        return (
          <div key={l.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[14px] font-semibold">
              {l.company_name}
              {verticalLabel(l.product) && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{verticalLabel(l.product)}</span>}
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                fo.status === 'submitted' ? 'bg-green-50 text-green-700'
                : fo.status === 'failed' ? 'bg-red-50 text-red-700'
                : fo.status === 'needs_manual' ? 'bg-amber-50 text-amber-700'
                : fo.status === 'queued' || fo.status === 'submitting' ? 'bg-blue-50 text-blue-700'
                : 'bg-gray-100 text-gray-600'}`}>
                {fo.status === 'needs_manual' ? 'needs manual' : fo.status}
              </span>
              {cf.captcha && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">captcha</span>}
              {cf.method === 'embedded' && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">embedded form</span>}
            </p>
            <p className="mb-3 text-[12px] text-gray-400">
              {l.location ?? ''}{l.score != null ? ` · score ${l.score}` : ''} ·{' '}
              <a href={cf.pageUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">open contact page</a>
            </p>
            <p className="mb-1 text-[13px] font-medium text-gray-800">{fo.subject}</p>
            <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-[13px] leading-relaxed text-gray-800">{fo.body}</pre>

            {fo.reason && (
              <p className="mt-2 text-[12.5px] text-amber-700">Needs a human: {fo.reason}</p>
            )}
            {fo.error && <p className="mt-2 text-[12.5px] text-red-600">Worker error: {fo.error}</p>}
            {fo.attempts && fo.attempts.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">Attempts</p>
                {fo.attempts.map((a, i) => (
                  <p key={`${a.at}-${i}`} className="text-[12px] text-gray-600">
                    {new Date(a.at).toLocaleString()} · {a.outcome}
                    {a.reason ? ` · ${a.reason}` : ''}
                    {a.screenshot ? ` · screenshot: ${a.screenshot}` : ''}
                  </p>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(fo.body).then(() => setNotice({ ok: true, text: 'Message copied.' }))}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
              >
                Copy message
              </button>
              {fo.status === 'ready' && !cf.captcha && cf.method !== 'embedded' && (
                <button
                  disabled={busy === l.id}
                  onClick={() => submitForMe(l.id)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Submit for me
                </button>
              )}
              {(fo.status === 'failed' || fo.status === 'needs_manual') && (
                <button
                  disabled={busy === l.id}
                  onClick={() => retryForm(l.id)}
                  className="rounded-lg border border-blue-300 px-3 py-1.5 text-[13px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  Retry with the worker
                </button>
              )}
              {(fo.status === 'ready' || fo.status === 'needs_manual' || fo.status === 'failed') && (
                <button disabled={busy === l.id} onClick={() => markForm(l.id, 'submitted')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Mark submitted</button>
              )}
              {fo.status === 'submitted' && (
                <button disabled={busy === l.id} onClick={() => markForm(l.id, 'replied')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50">Mark replied</button>
              )}
              {fo.status !== 'submitted' && fo.status !== 'skipped' && fo.status !== 'submitting' && (
                <button disabled={busy === l.id} onClick={() => markForm(l.id, 'skipped')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Skip</button>
              )}
            </div>
          </div>
        );
      })}

      {tab !== 'forms' && quota && (
        <p className="rounded-lg px-4 py-2 text-[13.5px] border border-gray-200 bg-white text-gray-700">
          Sent today: {quota.sentToday} (no daily cap).
        </p>
      )}
      {notice && (
        <p className={`rounded-lg px-4 py-2 text-[13.5px] border ${notice.ok ? 'border-gray-200 bg-white text-gray-700' : 'border-red-300 bg-red-50 text-red-700'}`}>{notice.text}</p>
      )}
      {loading && <p className="text-gray-400">Loading…</p>}
      {tab !== 'forms' && !loading && messages.length === 0 && <p className="text-gray-400">Nothing in {tab}.</p>}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreview(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-gray-200 px-4 py-3">
              <p className="text-[13px] text-gray-500">To: {preview.to} · {preview.variant === 'sample' ? 'with sample call' : 'plain (no sample)'}</p>
              <p className="text-[14px] font-semibold">{preview.subject}</p>
            </div>
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="min-h-[60vh] w-full flex-1 rounded-b-xl" />
            <button onClick={() => setPreview(null)} className="border-t border-gray-200 px-4 py-2 text-[13px] text-blue-600 hover:bg-gray-50">Close</button>
          </div>
        </div>
      )}

      {tab !== 'forms' && messages.map((m) => {
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
                  {verticalLabel(m.product) && (
                    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{verticalLabel(m.product)}</span>
                  )}
                  {m.status === 'draft' && (() => {
                    const t = product === 'calldesk' ? sampleTitles[m.product || 'calldesk'] ?? null : sampleTitle;
                    return (
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${t ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                        {t ? `Sample: ${t}` : 'No sample for this vertical'}
                      </span>
                    );
                  })()}
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
              {(m.status === 'draft' || m.status === 'approved') && (
                <button
                  disabled={busy === m.id}
                  onClick={() => openPreview(m, draft)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Preview email
                </button>
              )}
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
