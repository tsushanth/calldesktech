import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runChecks, integrationStatus, overall, type Check, type Level } from '@/lib/admin/health';
import { loadOverview, attentionItems, ago, type Overview } from '@/lib/admin/overview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin | CallDeskTech' };

// Stricter than the other /admin pages (which allow every ADMIN_EMAILS address): this one is the owner only.
const OWNER = (process.env.ADMIN_OWNER_EMAIL || 't.sushanth@gmail.com').toLowerCase();

const DOT: Record<Level, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', down: 'bg-red-500', off: 'bg-gray-300' };
const LABEL: Record<Level, string> = { ok: 'Healthy', warn: 'Degraded', down: 'Problem', off: 'Off' };

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-[13px] text-gray-500">{label}</p>
      <p className="mt-1 text-[28px] tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-gray-400">{hint}</p>}
    </div>
  );
}

function Rows({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-gray-100">
      {checks.map((c) => (
        <li key={c.name} className="flex items-center justify-between gap-4 px-5 py-3 text-[14px]">
          <span className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.level]}`} aria-hidden />
            <span>{c.name}</span>
            <span className="sr-only">{LABEL[c.level]}</span>
          </span>
          <span className="text-right text-[13px] text-gray-500">{c.detail}{c.ms !== undefined && c.level !== 'off' ? ` · ${c.ms} ms` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

function Bars({ data }: { data: Overview['signupsByDay'] }) {
  const max = Math.max(1, ...data.map((x) => x.v));
  return (
    <div>
      <div className="flex h-16 items-end gap-[3px]" role="img" aria-label="New accounts per day">
        {data.map((x) => (
          <div key={x.d} title={`${x.d}: ${x.v}`} className="flex-1 rounded-sm bg-[#00122e]" style={{ height: `${Math.max(x.v ? 6 : 2, (x.v / max) * 100)}%`, opacity: x.v ? 1 : 0.15 }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-400"><span>{data[0].d.slice(5)}</span><span>{data[data.length - 1].d.slice(5)}</span></div>
    </div>
  );
}

export default async function AdminHome() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect('/auth/signin?callbackUrl=/admin');
  if (email !== OWNER) notFound(); // signed in as someone else: don't reveal that the page exists

  const [checks, o] = await Promise.all([runChecks(), loadOverview()]);
  const integrations = integrationStatus();
  const level = overall(checks);
  const attention = attentionItems(o);

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-[13px] font-semibold text-gray-400">Internal</p>
        <h1 className="text-[17px] font-semibold">Admin</h1>
      </div>
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[15px]">
            <span className={`h-3 w-3 rounded-full ${DOT[level]}`} aria-hidden />
            <b>{level === 'ok' ? 'All systems healthy' : level === 'warn' ? 'Some systems degraded' : 'A system is down'}</b>
          </p>
          <nav className="flex gap-2 text-[13px]">
            {[['/admin/pilots', 'Pilots'], ['/admin/usage', 'Product usage'], ['/admin/traffic', 'Visitors'], ['/admin/outreach', 'Outreach']].map(([href, label]) => (
              <Link key={href} href={href} className="rounded-md bg-white px-3 py-1.5 text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50">{label}</Link>
            ))}
          </nav>
        </div>

        {attention.length > 0 && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-5" role="alert">
            <h2 className="text-[15px] font-medium">Needs attention</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">{attention.map((a) => <li key={a}>{a}</li>)}</ul>
          </section>
        )}

        <section className="rounded-lg border border-gray-200 bg-white">
          <h2 className="border-b border-gray-200 px-5 py-4 text-[15px] font-medium">System health</h2>
          <Rows checks={checks} />
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Accounts (excluding ours)" value={o.totals.users} />
          <Stat label="Customer workspaces" value={o.totals.workspaces} hint={`${o.totals.agents} agents · ${o.ours.workspaces} of ours excluded`} />
          <Stat label="Customer calls, last 24 h" value={o.calls.h24} hint={`${o.calls.d7} in 7 days · ${o.calls.d30} in 30 · ours excluded`} />
          <Stat label="Minutes, 7 days" value={o.calls.minutes7} hint={`last call ${ago(o.calls.lastCallAt)}`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-[15px] font-medium">New accounts, 14 days</h2>
            <div className="mt-4"><Bars data={o.signupsByDay} /></div>
            <p className="mt-3 text-[13px] text-gray-500">Our own demo and test calls, 30 days: {o.ours.calls30} (not counted above)</p>
            <p className="mt-1 text-[13px] text-gray-500">Customer calls this week: {Object.entries(o.calls.byOutcome).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}</p>
          </section>
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-[15px] font-medium">Outreach pipeline</h2>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 text-[14px]">
              <dt className="text-gray-500">Last email sent</dt><dd>{ago(o.outreach.lastSentAt)}</dd>
              <dt className="text-gray-500">Sent, 7 days</dt><dd className="tabular-nums">{o.outreach.sent7}</dd>
              <dt className="text-gray-500">Approved, waiting</dt><dd className="tabular-nums">{o.outreach.approvedQueue}</dd>
              <dt className="text-gray-500">Hard bounces / complaints</dt><dd className="tabular-nums">{o.outreach.hardBounces7} / {o.outreach.complaints7}</dd>
              <dt className="text-gray-500">Last discovery run</dt><dd>{o.outreach.lastRun ? `${o.outreach.lastRun.status}, ${ago(o.outreach.lastRun.at)}` : 'none'}</dd>
              <dt className="text-gray-500">Texts, last 24 h</dt><dd className="tabular-nums">{o.sms.h24} ({o.sms.failed24} failed)</dd>
            </dl>
          </section>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-[15px] font-medium">Integrations</h2>
            <p className="mt-0.5 text-[13px] text-gray-500">Whether each service has its credentials set. This does not test that the service itself is up.</p>
          </div>
          <Rows checks={integrations} />
        </section>

        <p className="text-[12px] text-gray-400">Checks run when you open this page, each with a 6 second limit. Crash and 5xx reports go to the failure reporter email. Visitors and page views live in PostHog.</p>
      </main>
    </div>
  );
}
