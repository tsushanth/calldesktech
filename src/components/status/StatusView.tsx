import { Container } from '@/components/landing/primitives';
import type { ComponentSnapshot, DayStatus, Incident, OverallState, StatusSnapshot } from '@/lib/status/types';
import { MIN_DAYS_FOR_UPTIME } from '@/lib/status/aggregate';

// Presentational and server-rendered. Honesty rules enforced here:
//  - days with no recorded checks render as neutral "no data", never green
//  - uptime percentages render only when the snapshot carries one (>= 7 days of real data)
//  - no SLA or compliance claims

const BANNER: Record<OverallState, { title: string; sub: string; tone: string }> = {
  operational: { title: 'All systems operational', sub: 'Every monitored component passed its most recent check.', tone: 'border-green-200 bg-green-50 text-green-900' },
  degraded: { title: 'Degraded performance', sub: 'At least one component is responding slower than normal or reporting load.', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  partial_outage: { title: 'Partial outage', sub: 'At least one component is failing its checks. Others are working.', tone: 'border-red-200 bg-red-50 text-red-900' },
  major_outage: { title: 'Major outage', sub: 'Every monitored component is failing its checks.', tone: 'border-red-300 bg-red-100 text-red-950' },
  starting: { title: 'Monitoring just started', sub: 'Checks began recently, so there is not much history to show yet.', tone: 'border-blue-200 bg-blue-50 text-blue-900' },
  stale: { title: 'Status data is out of date', sub: 'We have not received a recent check for at least one component, so we are not reporting it as healthy.', tone: 'border-gray-300 bg-gray-100 text-gray-900' },
};

const STATUS_LABEL: Record<ComponentSnapshot['status'], string> = {
  operational: 'Operational', degraded: 'Degraded', down: 'Down', unknown: 'No recent data',
};
const STATUS_TEXT: Record<ComponentSnapshot['status'], string> = {
  operational: 'text-green-800', degraded: 'text-amber-800', down: 'text-red-800', unknown: 'text-gray-600',
};
const DOT: Record<ComponentSnapshot['status'], string> = {
  operational: 'bg-green-600', degraded: 'bg-amber-500', down: 'bg-red-600', unknown: 'bg-gray-400',
};
const DAY_CLASS: Record<DayStatus, string> = {
  operational: 'bg-green-500',
  degraded: 'bg-amber-400',
  down: 'bg-red-500',
  no_data: 'bg-gray-200',
};
const DAY_LABEL: Record<DayStatus, string> = { operational: 'operational', degraded: 'degraded', down: 'down', no_data: 'no data' };
const INCIDENT_LABEL: Record<Incident['status'], string> = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved' };

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

function DayBar({ c }: { c: ComponentSnapshot }) {
  const counts = c.days.reduce<Record<DayStatus, number>>((a, d) => ({ ...a, [d.status]: a[d.status] + 1 }), { operational: 0, degraded: 0, down: 0, no_data: 0 });
  const summary = `Last 90 days: ${counts.operational} days operational, ${counts.degraded} degraded, ${counts.down} with failures, ${counts.no_data} with no data.`;
  return (
    <div>
      <div role="img" aria-label={summary} className="flex h-8 items-stretch gap-[2px]">
        {c.days.map((d) => (
          <div key={d.date} title={`${d.date}: ${DAY_LABEL[d.status]}`} className={`min-w-0 flex-1 rounded-[2px] ${DAY_CLASS[d.status]}`} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-gray-500" aria-hidden="true">
        <span>90 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function ComponentRow({ c, uptimeShown }: { c: ComponentSnapshot; uptimeShown: boolean }) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-[16px] font-medium text-[#00122e]">{c.name}</h3>
          <p className="mt-0.5 text-[13px] leading-[1.4] text-gray-500">{c.description}</p>
        </div>
        <p className={`flex items-center gap-2 text-[14px] font-medium ${STATUS_TEXT[c.status]}`}>
          <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[c.status]}`} />
          {STATUS_LABEL[c.status]}
        </p>
      </div>
      <div className="mt-4"><DayBar c={c} /></div>
      <p className="mt-3 text-[13px] text-gray-500">
        {c.latencyMs !== null ? `Last response ${c.latencyMs} ms` : 'No recent response time'}
        {uptimeShown && c.uptimePercent !== null ? ` · ${c.uptimePercent}% of checks passed (90 days)` : ''}
      </p>
    </li>
  );
}

function IncidentItem({ i }: { i: Incident }) {
  const open = i.status !== 'resolved';
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[16px] font-medium text-[#00122e]">{i.title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${open ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'}`}>{INCIDENT_LABEL[i.status]}</span>
      </div>
      <p className="mt-1 text-[13px] text-gray-500">
        Started {fmtDateTime(i.started_at)}{i.resolved_at ? `, resolved ${fmtDateTime(i.resolved_at)}` : ''}
      </p>
      {i.body ? <p className="mt-3 whitespace-pre-line text-[14px] leading-[1.55] text-gray-700">{i.body}</p> : null}
    </li>
  );
}

export function StatusUnavailable() {
  return (
    <main>
      <Container className="py-14 sm:py-20">
        <h1 className="text-[32px] font-normal leading-[1.1] tracking-[-0.05em] sm:text-[44px]">System status</h1>
        <div role="status" className="mt-8 rounded-xl border border-gray-300 bg-gray-100 p-5 text-gray-900">
          <p className="text-[18px] font-medium">Status data is temporarily unavailable</p>
          <p className="mt-1 text-[14px]">We could not load monitoring data just now. This does not mean services are healthy or unhealthy. Please retry shortly or email{' '}
            <a className="underline" href="mailto:support@calldesk.tech">support@calldesk.tech</a>.</p>
        </div>
      </Container>
    </main>
  );
}

export function StatusView({ snapshot: s }: { snapshot: StatusSnapshot }) {
  const banner = BANNER[s.overall];
  const openIncidents = s.incidents.filter((i) => i.status !== 'resolved');
  const pastIncidents = s.incidents.filter((i) => i.status === 'resolved');
  return (
    <main>
      <Container className="py-14 sm:py-20">
        <h1 className="text-[32px] font-normal leading-[1.1] tracking-[-0.05em] sm:text-[44px]">System status</h1>
        <p className="mt-3 max-w-[640px] text-[16px] leading-[1.5] text-gray-600">
          Live results from automated checks that run every minute against our production services. Nothing on this page is estimated or filled in.
        </p>

        <div role="status" className={`mt-8 rounded-xl border p-5 ${banner.tone}`}>
          <p className="text-[20px] font-medium tracking-[-0.02em]">{banner.title}</p>
          <p className="mt-1 text-[14px]">{banner.sub}</p>
        </div>

        {openIncidents.length > 0 && (
          <section className="mt-10" aria-labelledby="active-incidents">
            <h2 id="active-incidents" className="text-[20px] font-medium tracking-[-0.03em]">Active incidents</h2>
            <ul className="mt-4 space-y-3">{openIncidents.map((i) => <IncidentItem key={i.id} i={i} />)}</ul>
          </section>
        )}

        <section className="mt-10" aria-labelledby="components">
          <h2 id="components" className="text-[20px] font-medium tracking-[-0.03em]">Components</h2>
          <ul className="mt-4 space-y-3">{s.components.map((c) => <ComponentRow key={c.id} c={c} uptimeShown={s.uptimeShown} />)}</ul>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-gray-600" aria-label="Legend">
            {(['operational', 'degraded', 'down', 'no_data'] as DayStatus[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block h-3 w-3 rounded-[2px] ${DAY_CLASS[k]}`} />{k === 'down' ? 'Failed checks' : k === 'no_data' ? 'No data' : k[0].toUpperCase() + k.slice(1)}</span>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-labelledby="incident-history">
          <h2 id="incident-history" className="text-[20px] font-medium tracking-[-0.03em]">Past incidents (30 days)</h2>
          {pastIncidents.length === 0
            ? <p className="mt-3 text-[14px] text-gray-600">No incidents have been posted in the last 30 days. Incidents are written by our team; the bars above come from automated checks and can show failed checks that have no written incident.</p>
            : <ul className="mt-4 space-y-3">{pastIncidents.map((i) => <IncidentItem key={i.id} i={i} />)}</ul>}
        </section>

        <section className="mt-10 rounded-xl border border-gray-200 bg-gray-50 p-5 text-[14px] leading-[1.6] text-gray-700" aria-labelledby="about-monitoring">
          <h2 id="about-monitoring" className="text-[16px] font-medium text-[#00122e]">About this monitoring</h2>
          <p className="mt-2">
            {s.monitoringSince ? <>Monitoring since <strong>{fmtDate(s.monitoringSince)}</strong>. </> : <>No checks have been recorded yet. </>}
            {s.totalChecks.toLocaleString('en-US')} checks recorded in the last 90 days.
            {s.lastCheckedAt ? <> Last check {fmtDateTime(s.lastCheckedAt)}.</> : null}
          </p>
          <p className="mt-2">
            {s.uptimeShown
              ? 'Percentages show the share of completed checks that did not fail. Minutes with no check are not counted.'
              : `We show no uptime percentage until at least ${MIN_DAYS_FOR_UPTIME} days of real checks exist. A number from a few hours of data would not mean anything.`}
          </p>
          <p className="mt-2">
            A component is <em>down</em> when its check errors, times out after 8 seconds, or returns a non-2xx response; <em>degraded</em> when it answers correctly but slowly (over 2 s, or 3 s for the web app) or reports it is shedding load. Each bar shows the worst result of that UTC day. This page reports what our checks observe; it is not a service level agreement.
          </p>
          <p className="mt-2">
            Machine-readable: <a className="underline" href="/api/status">/api/status</a>. Problems or questions: <a className="underline" href="mailto:support@calldesk.tech">support@calldesk.tech</a>.
          </p>
        </section>
      </Container>
    </main>
  );
}
