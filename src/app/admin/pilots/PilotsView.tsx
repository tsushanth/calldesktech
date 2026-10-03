import Link from 'next/link';
import type { PilotCall, PilotRow, PilotStats, PilotStatus } from '@/lib/pilots';
import { callSentiment, callSeconds, callSummary, isFailedCall, isShortCall } from '@/lib/pilots';
import { PilotActionButtons } from './PilotActions';

// Presentational: takes plain data, so the page, the detail page and a fixture preview all render the same markup.

export interface PilotListItem { pilot: PilotRow; tenantName: string | null; stats: PilotStats }

const STATUS_STYLE: Record<PilotStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  capped: 'bg-red-50 text-red-700 ring-red-200',
  expired: 'bg-amber-50 text-amber-800 ring-amber-200',
  converted: 'bg-blue-50 text-blue-700 ring-blue-200',
  stopped: 'bg-gray-100 text-gray-600 ring-gray-200',
};

export function ago(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function StatusBadge({ status }: { status: PilotStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ${STATUS_STYLE[status]}`}>{status}</span>;
}

export function CapBar({ used, cap, percent }: { used: number; cap: number; percent: number }) {
  const color = percent >= 100 ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-[#00122e]';
  return (
    <div>
      <div className="flex justify-between text-[12px] tabular-nums text-gray-500"><span>{used} of {cap} min</span><span>{Math.round(percent)}%</span></div>
      <div className="mt-1 h-2 rounded bg-gray-100" role="img" aria-label={`${Math.round(percent)} percent of the minute cap used`}>
        <div className={`h-2 rounded ${color}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

export function PilotList({ items, now, migrationApplied = true }: { items: PilotListItem[]; now: number; migrationApplied?: boolean }) {
  if (!migrationApplied) {
    return <p className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-[14px]">The pilots table does not exist yet. Apply supabase/migrations/068_pilots.sql first.</p>;
  }
  if (!items.length) return <p className="rounded-lg border border-gray-200 bg-white p-5 text-[14px] text-gray-500">No pilots yet. Create one when a design partner agrees to try it.</p>;
  return (
    <ul className="space-y-3">
      {items.map(({ pilot, tenantName, stats }) => (
        <li key={pilot.id} className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Link href={`/admin/pilots/${pilot.id}`} className="text-[15px] font-medium hover:underline">{pilot.company || tenantName || 'Unnamed pilot'}</Link>
              <p className="text-[13px] text-gray-500">{[pilot.contact_name, pilot.vertical].filter(Boolean).join(' · ') || 'No contact details'}</p>
            </div>
            <StatusBadge status={stats.effectiveStatus} />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_9rem_10rem_6.5rem] sm:items-end">
            <CapBar used={stats.minutesUsed} cap={Number(pilot.minutes_cap)} percent={stats.percentOfCap} />
            <p className="text-[13px] tabular-nums"><span className="text-gray-500">Calls </span>{stats.calls}{stats.failedCalls > 0 && <span className="text-red-600"> ({stats.failedCalls} failed)</span>}</p>
            <p className="text-[13px]"><span className="text-gray-500">Last call </span>{ago(stats.lastCallAt, now)}</p>
            <p className="text-[13px]"><span className="text-gray-500">Days left </span>{stats.daysLeft}</p>
          </div>
          <p className={`mt-3 text-[13px] ${stats.nextAction.urgent ? 'font-medium text-amber-800' : 'text-gray-500'}`}>Next: {stats.nextAction.label}</p>
        </li>
      ))}
    </ul>
  );
}

const sentimentColor = { positive: 'text-emerald-700', neutral: 'text-gray-600', negative: 'text-red-700', unknown: 'text-gray-400' } as const;

export function PilotDetail({ pilot, tenantName, stats, calls, now }: { pilot: PilotRow; tenantName: string | null; stats: PilotStats; calls: PilotCall[]; now: number }) {
  const shown = calls.filter((c) => !c.is_internal_test && Date.parse(c.created_at) >= Date.parse(pilot.started_at));
  const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  return (
    <div className="space-y-6">
      <Link href="/admin/pilots" className="text-[13px] text-gray-500 hover:underline">All pilots</Link>
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-[18px] font-semibold">{pilot.company || tenantName || 'Unnamed pilot'}</h2>
            <p className="text-[13px] text-gray-500">{[pilot.contact_name, pilot.contact_email, pilot.vertical].filter(Boolean).join(' · ')}</p>
            <p className="text-[13px] text-gray-500">Started {fmt(pilot.started_at)} · ends {fmt(pilot.ends_at)} · {stats.daysLeft} days left</p>
          </div>
          <StatusBadge status={stats.effectiveStatus} />
        </div>
        <div className="mt-4"><CapBar used={stats.minutesUsed} cap={Number(pilot.minutes_cap)} percent={stats.percentOfCap} /></div>
        <p className={`mt-3 text-[14px] ${stats.nextAction.urgent ? 'font-medium text-amber-800' : 'text-gray-600'}`}>Next: {stats.nextAction.label}. Follow up by {stats.followUpBy.slice(0, 10)}.</p>
        {pilot.notes && <p className="mt-3 whitespace-pre-wrap text-[13px] text-gray-600">{pilot.notes}</p>}
        <div className="mt-4"><PilotActionButtons id={pilot.id} status={stats.effectiveStatus} /></div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Calls', stats.calls],
          ['Minutes left', stats.minutesRemaining],
          ['Failed / under 10 s', `${stats.failedCalls} / ${stats.shortCalls}`],
          ['Last call', ago(stats.lastCallAt, now)],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-[13px] text-gray-500">{k}</p>
            <p className="mt-1 text-[24px] tracking-tight tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-medium">Outcomes and sentiment</h2>
        <p className="mt-2 text-[14px] text-gray-700">{Object.entries(stats.outcomes).map(([k, v]) => `${k} ${v}`).join(', ') || 'No calls yet'}</p>
        <p className="mt-1 text-[13px] text-gray-500">Sentiment: {stats.sentiment.positive} positive, {stats.sentiment.neutral} neutral, {stats.sentiment.negative} negative, {stats.sentiment.unknown} unknown</p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-5 py-4 text-[15px] font-medium">Calls ({shown.length})</h2>
        {!shown.length ? <p className="px-5 py-4 text-[14px] text-gray-500">No calls yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {shown.map((c) => {
              const s = callSentiment(c);
              const bad = isFailedCall(c);
              return (
                <li key={c.id} className="px-5 py-3 text-[14px]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <span className="tabular-nums text-gray-500">{fmt(c.created_at)}</span>
                    <span className="tabular-nums">{Math.floor(callSeconds(c) / 60)}m {callSeconds(c) % 60}s</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">{c.outcome || 'unknown'}</span>
                    <span className={sentimentColor[s]}>{s}</span>
                    {bad && <span className="font-medium text-red-600">failed</span>}
                    {!bad && isShortCall(c) && <span className="font-medium text-amber-700">under 10 s</span>}
                  </div>
                  <p className="mt-1 text-gray-800">{callSummary(c) || <span className="text-gray-400">No summary</span>}</p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-gray-100 px-5 py-3 text-[12px] text-gray-400">Transcripts live on the customer call-log page, which needs access to their workspace; they are not linked from here.</p>
      </section>
    </div>
  );
}
