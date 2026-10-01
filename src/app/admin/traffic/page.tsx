import Link from 'next/link';
import { postHogConfigured } from '@/lib/visitors/posthog';
import { loadVisitors } from '@/lib/visitors/report';
import { loadPeople } from '@/lib/visitors/people';
import { summarize, type ClassifiedVisitor } from '@/lib/visitors/classify';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Visitors and interest | CallDeskTech' };

const DAY_CHOICES = [7, 14, 30];

function ago(iso: string): string {
  // Async Server Component rendering a per-request snapshot.
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-[13px] text-gray-500">{label}</p>
      <p className="mt-1 text-[28px] tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-gray-400">{hint}</p>}
    </div>
  );
}

function VisitorTable({ rows, showReason }: { rows: ClassifiedVisitor[]; showReason?: boolean }) {
  if (!rows.length) return <p className="px-5 py-6 text-[14px] text-gray-400">Nobody yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-[13px]">
        <thead className="border-b border-gray-200 text-[12px] text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Last seen</th>
            <th className="px-4 py-2 font-medium">Who</th>
            <th className="px-4 py-2 font-medium">Where</th>
            <th className="px-4 py-2 font-medium">Device</th>
            <th className="px-4 py-2 font-medium">Came from</th>
            <th className="px-4 py-2 font-medium">Looked at</th>
            <th className="px-4 py-2 font-medium">{showReason ? 'Why filtered' : 'Tried'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((v) => (
            <tr key={v.ip} className={v.engaged ? 'bg-[#f3f7ff]' : ''}>
              <td className="whitespace-nowrap px-4 py-2.5"><span title={when(v.lastSeen)}>{ago(v.lastSeen)}</span></td>
              <td className="px-4 py-2.5">
                {v.email ? <span className="font-medium">{v.email}</span> : <span className="text-gray-500">Visitor</span>}
                <span className="block font-mono text-[11px] text-gray-400">{v.ip}</span>
              </td>
              <td className="px-4 py-2.5">{[v.city, v.country].filter(Boolean).join(', ') || 'Unknown'}</td>
              <td className="px-4 py-2.5">{[v.os, v.device === 'Mobile' ? 'phone' : null].filter(Boolean).join(' ') || 'Unknown'}</td>
              <td className="px-4 py-2.5">{v.referrer && v.referrer !== '$direct' ? v.referrer : 'Direct'}</td>
              <td className="px-4 py-2.5">
                {v.pageviews} {v.pageviews === 1 ? 'page' : 'pages'}
                <span className="block max-w-[260px] truncate text-[11px] text-gray-400" title={v.paths.join(', ')}>{v.paths.join(', ')}</span>
              </td>
              <td className="px-4 py-2.5">
                {showReason ? (
                  <span className="text-gray-500">{v.reason}</span>
                ) : (
                  [v.heroStarted ? 'hero demo' : null, v.demoCalls ? 'phone/browser demo' : null, v.setupActions ? 'built an agent' : null].filter(Boolean).join(', ') || <span className="text-gray-300">No</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TrafficPage({ searchParams }: { searchParams: Promise<{ days?: string; show?: string }> }) {
  const sp = await searchParams;
  const days = DAY_CHOICES.includes(Number(sp.days)) ? Number(sp.days) : 14;
  const showAll = sp.show === 'all';

  const configured = postHogConfigured();
  let visitors: ClassifiedVisitor[] = [];
  let visitorError: string | null = null;
  if (configured) {
    try { visitors = await loadVisitors(days); } catch (e) { visitorError = e instanceof Error ? e.message : 'PostHog query failed'; }
  }
  const people = await loadPeople();
  const outsiders = people.filter((p) => !p.internal);

  const summary = summarize(visitors);
  const humans = visitors.filter((v) => v.kind === 'human').sort((a, b) => Number(b.engaged) - Number(a.engaged) || b.lastSeen.localeCompare(a.lastSeen));
  const filtered = visitors.filter((v) => v.kind !== 'human');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-gray-500">Who has looked at calldesk.tech and tried the product, with our own testing and automated traffic filtered out.</p>
        <div className="flex gap-1 text-[13px]">
          {DAY_CHOICES.map((d) => (
            <Link key={d} href={`/admin/traffic?days=${d}${showAll ? '&show=all' : ''}`} className={`rounded-md px-3 py-1.5 ${d === days ? 'bg-[#00122e] text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>{d} days</Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="People who signed in" value={outsiders.length} hint={`${people.length - outsiders.length} of ours excluded`} />
        <Card label="Built something" value={outsiders.filter((p) => p.agents > 0).length} hint="Created at least one agent" />
        <Card label={`Likely visitors (${days} d)`} value={configured && !visitorError ? summary.human : 'n/a'} hint={configured && !visitorError ? `${summary.engaged} engaged` : 'Needs the PostHog key'} />
        <Card label="Tried a demo (visitors)" value={configured && !visitorError ? summary.heroStarted + summary.demoCalls : 'n/a'} hint="Hero chat, phone or browser demo" />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-[15px] font-medium">People who signed in</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">From our database, so it is exact. Anyone using an admin email is marked ours.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-gray-200 text-[12px] text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2 font-medium">Last activity</th>
                <th className="px-4 py-2 font-medium">Workspaces</th>
                <th className="px-4 py-2 font-medium">Agents</th>
                <th className="px-4 py-2 font-medium">Versions</th>
                <th className="px-4 py-2 font-medium">Calls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {people.map((p) => (
                <tr key={p.id} className={p.internal ? 'text-gray-400' : p.agents > 0 ? 'bg-[#f3f7ff]' : ''}>
                  <td className="px-4 py-2.5"><span className={p.internal ? '' : 'font-medium text-[#1a1d29]'}>{p.email}</span>{p.internal && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">ours</span>}{p.name && <span className="block text-[11px] text-gray-400">{p.name}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{when(p.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{ago(p.lastActivity)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{p.workspaces}</td>
                  <td className="px-4 py-2.5 tabular-nums">{p.agents}</td>
                  <td className="px-4 py-2.5 tabular-nums">{p.versions}</td>
                  <td className="px-4 py-2.5 tabular-nums">{p.calls}</td>
                </tr>
              ))}
              {!people.length && <tr><td colSpan={7} className="px-5 py-6 text-gray-400">Nobody has signed in yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {!configured && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-[14px] leading-[1.55]">
          <h2 className="text-[15px] font-medium">Turn on the visitor list</h2>
          <p className="mt-2">Visitors come from PostHog, which needs a read-only key once:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>In PostHog, open your profile menu, then <b>Personal API keys</b>, then <b>Create personal API key</b>.</li>
            <li>Give it the <b>Query: Read</b> scope, limited to the Default project, and copy it.</li>
            <li>Run <code className="rounded bg-white px-1.5 py-0.5 text-[12px]">flyctl secrets set POSTHOG_PERSONAL_API_KEY=&lt;key&gt; -a calldesk-tech</code>.</li>
            <li>Optional: <code className="rounded bg-white px-1.5 py-0.5 text-[12px]">ANALYTICS_INTERNAL_IPS</code> is a comma-separated list of your own addresses (end one with <code>*</code> for a network prefix) so your testing is filtered out.</li>
          </ol>
        </section>
      )}

      {configured && visitorError && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-[14px]" role="alert">
          <h2 className="text-[15px] font-medium">Could not load visitors</h2>
          <p className="mt-1 text-red-800">{visitorError}</p>
        </section>
      )}

      {configured && !visitorError && (
        <>
          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-[15px] font-medium">Visitors who look like people</h2>
              <p className="mt-0.5 text-[13px] text-gray-500">Highlighted rows went beyond one page or tried something. Grouped by network address, so two devices on one network show as one.</p>
            </div>
            <VisitorTable rows={humans} />
          </section>

          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-[15px] font-medium">Filtered out</h2>
                <p className="mt-0.5 text-[13px] text-gray-500">{summary.internal} ours, {summary.automated} automated, {summary.unsubscribe} unsubscribe links. These are guesses, so check them if a number looks wrong.</p>
              </div>
              <Link href={`/admin/traffic?days=${days}${showAll ? '' : '&show=all'}`} className="text-[13px] text-[#0a2a86] underline underline-offset-2">{showAll ? 'Hide' : 'Show the list'}</Link>
            </div>
            {showAll && <VisitorTable rows={filtered} showReason />}
          </section>
        </>
      )}
    </div>
  );
}
