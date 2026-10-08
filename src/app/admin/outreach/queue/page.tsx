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
  experiment_arm?: string | null;
  sources?: string[];
  translation_subject?: string | null;
  translation_body?: string | null;
  product?: string | null;
  lead: { company_name: string; domain: string | null; score: number | null; tier: string | null; contact_source_url: string | null; replied_at: string | null; phone: string | null } | null;
}

const TABS = ['draft', 'approved', 'sent', 'failed', 'forms', 'worker'] as const;
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
  { key: 'reseller', label: 'Resellers & agencies' },
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
interface WorkerRow {
  id: string;
  created_at: string;
  lead_id: string | null;
  product: string | null;
  company_name: string | null;
  domain: string | null;
  page_url: string | null;
  reason: string | null;
  outcome: 'submitted' | 'needs_manual' | 'failed';
  proof: 'page' | 'email';
  confirmed_by: string | null;
  screenshot: string | null;
  /** Where the lead stands now (a human may have finished it since). */
  lead_status: string | null;
  dismissed_at: string | null;
  /** The message to paste into the form, for attempts that still need a human. */
  message: { subject: string | null; body: string } | null;
}

interface WorkerCounts {
  all: { attempts: number; delivered: number; needsManual: number; failed: number; done: number };
  last24h: { attempts: number; delivered: number; needsManual: number; failed: number };
  byEmail: number;
}

const WORKER_FILTERS = [
  { key: 'all', label: 'All tried' },
  { key: 'submitted', label: 'Delivered' },
  { key: 'needs_manual', label: 'Needs you' },
  { key: 'failed', label: 'Failed' },
] as const;
const NOW_LABEL: Record<string, string> = {
  submitted: 'now: submitted',
  ready: 'now: back with the worker',
  needs_manual: 'now: needs manual',
  queued: 'now: queued',
  submitting: 'now: in flight',
  failed: 'now: failed',
  replied: 'now: replied',
  skipped: 'now: skipped',
};

const verticalLabel = (product?: string | null) => (product === 'calldesk' ? 'Reseller / agency' : VERTICALS.find((v) => v.key && product === `calldesk:${v.key}`)?.label ?? null);

interface FormLead {
  id: string;
  company_name: string;
  domain: string | null;
  location: string | null;
  score: number | null;
  product: string;
  signals: {
    contactForm?: { pageUrl: string; captcha: boolean; method: string; embedded?: string; fields?: unknown[] };
    formOutreach?: {
      subject: string;
      body: string;
      status: string;
      reason?: string;
      note?: string;
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


export default function OutreachQueuePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('draft');
  const [product, setProduct] = useState<string>('calldesk');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [armStats, setArmStats] = useState<{ arm: string; sent: number; replied: number; replyRate: number }[]>([]);
  const [quota, setQuota] = useState<{ sentToday: number; cap: number; resets: string } | null>(null);
  const [vertical, setVertical] = useState<string>('');
  // The forms tab has its own filter and opens on resellers: the all-verticals lookup scans about half a million leads and takes seconds.
  const [formVertical, setFormVertical] = useState<string>('reseller');
  const [sampleTitles, setSampleTitles] = useState<Record<string, string | null>>({});
  const [sampleTitle, setSampleTitle] = useState<string | null>(null);
  const [formLeads, setFormLeads] = useState<FormLead[]>([]);
  const [formStatus, setFormStatus] = useState<(typeof FORM_STATUSES)[number]>('ready');
  const [formCounts, setFormCounts] = useState<Record<string, number>>({});
  const [workerRows, setWorkerRows] = useState<WorkerRow[]>([]);
  const [workerCounts, setWorkerCounts] = useState<WorkerCounts | null>(null);
  const [workerFilter, setWorkerFilter] = useState<(typeof WORKER_FILTERS)[number]['key']>('all');
  const [preview, setPreview] = useState<{ subject: string; to: string; html: string; variant: string | null } | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; body_text: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    if (tab === 'worker') {
      const wr = await fetch(`/api/admin/outreach/worker?outcome=${workerFilter}`);
      if (wr.ok) {
        const wb = await wr.json();
        setWorkerRows(wb.rows ?? []);
        setWorkerCounts(wb.counts ?? null);
      }
      setLoading(false);
      return;
    }
    if (tab === 'forms') {
      const fr = await fetch(`/api/admin/outreach/forms?status=${formStatus}${formVertical ? `&vertical=${formVertical}` : ''}`);
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
      setArmStats(Array.isArray(body.armStats) ? body.armStats : []);
      setQuota({ sentToday: body.sentToday, cap: body.cap, resets: body.resets });
    }
    setLoading(false);
  }, [tab, product, vertical, formVertical, formStatus, workerFilter]);

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

  // The Worker tab's "Done": the human finished this form by hand. The lead is marked submitted (the worker never retries it) and the row leaves "needs you".
  const markWorkerDone = async (id: string) => {
    if (!window.confirm('Mark this form as sent by you? The worker will not try it again.')) return;
    const res = await fetch('/api/admin/outreach/worker', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (res.ok) setNotice({ ok: true, text: 'Marked done.' });
    else setNotice({ ok: false, text: (await res.json().catch(() => ({}))).error ?? 'Could not mark it done.' });
    await refresh();
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
            value={tab === 'forms' ? formVertical : vertical}
            onChange={(e) => (tab === 'forms' ? setFormVertical(e.target.value) : setVertical(e.target.value))}
            className="rounded-lg border border-gray-300 px-2 py-1 text-[13px]"
          >
            {VERTICALS.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
        )}
        {tab === 'forms' && formVertical === '' && <span className="text-[12px] text-gray-400">All verticals can take several seconds to load.</span>}
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
            Submitted today: {formCounts.submittedToday ?? 0} · needs manual: {formCounts.needs_manual ?? 0}
            {formCounts.failed ? ` · failed: ${formCounts.failed}` : ''}
          </p>
          <p className="text-[13px] text-gray-500">
            Companies with no public email. For each one: <strong>Copy message</strong>, open the form link, paste it, send it yourself, then mark it
            <em> submitted</em>. Nothing is sent automatically.
          </p>
        </>
      )}
      {tab === 'worker' && (
        <>
          <p className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] text-gray-700" data-testid="worker-counts">
            Tried by the worker: {workerCounts?.all.attempts ?? 0} (last 24 h: {workerCounts?.last24h.attempts ?? 0}) · delivered {workerCounts?.all.delivered ?? 0}
            {' '}(by the company&apos;s auto-reply: {workerCounts?.byEmail ?? 0}) · needs you {workerCounts?.all.needsManual ?? 0} · failed {workerCounts?.all.failed ?? 0} · done by you {workerCounts?.all.done ?? 0}
          </p>
          <div className="flex flex-wrap gap-1">
            {WORKER_FILTERS.map((f) => {
              const n = !workerCounts ? 0 : f.key === 'all' ? workerCounts.all.attempts : f.key === 'submitted' ? workerCounts.all.delivered : f.key === 'needs_manual' ? workerCounts.all.needsManual : workerCounts.all.failed;
              return (
                <button key={f.key} onClick={() => setWorkerFilter(f.key)} className={`rounded-lg px-3 py-1 text-[12.5px] font-medium ${workerFilter === f.key ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}>
                  {f.label}
                  {n ? <span className="ml-1 text-gray-400">{n}</span> : null}
                </button>
              );
            })}
          </div>
          <p className="text-[13px] text-gray-500">
            Every attempt, newest first. &quot;Delivered&quot; = the site showed a confirmation, or the company&apos;s own auto-reply reached outreach@. &quot;Needs you&quot; and &quot;Failed&quot; carry the reason; finish those in the forms tab (needs manual). The grey badge is where the lead stands now.
          </p>
          {!loading && workerRows.length === 0 && <p className="text-gray-400">Nothing here yet.</p>}
          {workerRows.map((r) => (
            <div key={r.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-[14px] font-semibold">
                {r.company_name ?? r.domain}
                <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{verticalLabel(r.product) ?? 'Reseller / agency'}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  r.outcome === 'submitted' ? (r.proof === 'email' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700')
                  : r.dismissed_at ? 'bg-gray-100 text-gray-600'
                  : r.outcome === 'failed' ? 'bg-red-50 text-red-700'
                  : 'bg-amber-50 text-amber-700'}`}>
                  {r.outcome === 'submitted' ? (r.proof === 'email' ? 'delivered, auto-reply received' : 'delivered, page confirmed') : r.dismissed_at ? 'done by you' : r.outcome === 'failed' ? 'failed' : 'needs you'}
                </span>
                {r.lead_status && <span className="ml-2 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500">{NOW_LABEL[r.lead_status] ?? `now: ${r.lead_status}`}</span>}
              </p>
              <p className="text-[12px] text-gray-400">
                {new Date(r.created_at).toLocaleString()} · {r.domain}
                {r.page_url && <> · <a href={r.page_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">form page</a></>}
              </p>
              {r.outcome !== 'submitted' && r.reason && (
                <p className="mt-1 text-[12.5px] text-amber-700">
                  {r.reason.startsWith('unconfirmed')
                    ? `${r.reason}. The worker filled the form and clicked submit but the page showed no thank-you, so it may or may not have gone through. Check the site before pasting.`
                    : r.reason}
                </p>
              )}
              {r.outcome !== 'submitted' && r.dismissed_at && <p className="mt-1 text-[12px] text-gray-500">Done by you.</p>}
              {r.outcome !== 'submitted' && !r.dismissed_at && r.lead_status === 'submitted' && <p className="mt-1 text-[12px] text-gray-500">Since marked submitted.</p>}
              {r.outcome !== 'submitted' && !r.dismissed_at && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.message && (
                    <button
                      onClick={() => navigator.clipboard.writeText(r.message!.body).then(() => setNotice({ ok: true, text: 'Message copied.' }))}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Copy message
                    </button>
                  )}
                  <button onClick={() => markWorkerDone(r.id)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700">
                    Done
                  </button>
                </div>
              )}
              {r.confirmed_by && <p className="mt-1 text-[12px] text-gray-500">{r.confirmed_by}</p>}
            </div>
          ))}
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

            {fo.note && <p className="mt-2 text-[12.5px] text-gray-500">Note: {fo.note}</p>}
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

      {tab !== 'forms' && armStats.length > 0 && (
        <p className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-[12.5px] text-purple-800">
          Freight experiment, first emails sent / replied: {armStats.map((a) => `${a.arm} ${a.sent} / ${a.replied} (${(a.replyRate * 100).toFixed(1)}%)`).join(' · ')}
        </p>
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
                  {m.experiment_arm && <span className="ml-2 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700" title="Freight experiment arm (free_week = one-week pilot offer, demo = 15-minute demo ask)">arm: {m.experiment_arm}</span>}
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
                  {m.lead?.phone ? ` · ${m.lead.phone}` : ''}
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
