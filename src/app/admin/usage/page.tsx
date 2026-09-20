import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Product usage | CallDeskTech' };

const DAYS = 30;
const day = (iso: string) => iso.slice(0, 10);

function lastDays(n: number) {
  return Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86400_000).toISOString().slice(0, 10));
}

function Bars({ data, label }: { data: { d: string; v: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((x) => x.v));
  const total = data.reduce((a, x) => a + x.v, 0);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-medium">{label}</h2>
        <p className="text-[13px] text-gray-500">{total.toLocaleString()} in {DAYS} days</p>
      </div>
      <div className="mt-4 flex h-24 items-end gap-[3px]" role="img" aria-label={`${label} per day`}>
        {data.map((x) => (
          <div key={x.d} title={`${x.d}: ${x.v}`} className="flex-1 rounded-sm bg-[#00122e]" style={{ height: `${Math.max(x.v ? 4 : 1, (x.v / max) * 100)}%`, opacity: x.v ? 1 : 0.15 }} />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-gray-400"><span>{data[0].d.slice(5)}</span><span>{data[data.length - 1].d.slice(5)}</span></div>
    </div>
  );
}

export default async function UsagePage() {
  const db = getSupabaseAdmin();
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
  const [tenants, agents, calls, billing, clients, keys] = await Promise.all([
    db.from('calldesk_tenants').select('id, user_id, created_at').limit(10000),
    db.from('calldesk_agents').select('tenant_id').limit(20000),
    db.from('calldesk_call_logs').select('tenant_id, duration_seconds, created_at, direction').neq('is_internal_test', true).limit(50000),
    db.from('calldesk_businesses').select('tenant_id, subscription_status').limit(10000),
    db.from('calldesk_oauth_clients').select('client_name, created_at').limit(1000),
    db.from('calldesk_api_keys').select('name, last_used_at, revoked_at').like('name', 'MCP:%').limit(1000),
  ]);

  const T = tenants.data || [], A = agents.data || [], C = calls.data || [], B = billing.data || [];
  const days = lastDays(DAYS);
  const bucket = (rows: { created_at: string }[], val: (r: never) => number = () => 1) => {
    const m = new Map(days.map((d) => [d, 0]));
    for (const r of rows) if (r.created_at >= since) { const k = day(r.created_at); if (m.has(k)) m.set(k, (m.get(k) || 0) + val(r as never)); }
    return days.map((d) => ({ d, v: Math.round((m.get(d) || 0) * 10) / 10 }));
  };

  const withAgent = new Set(A.map((a) => a.tenant_id));
  const withCall = new Set(C.map((c) => c.tenant_id));
  const paying = new Set(B.filter((b) => ['active', 'trialing'].includes(b.subscription_status)).map((b) => b.tenant_id));
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const active7 = new Set(C.filter((c) => c.created_at >= weekAgo).map((c) => c.tenant_id));
  const minutes = C.reduce((a, c) => a + (c.duration_seconds || 0), 0) / 60;

  const funnel = [
    { label: 'Workspaces created', n: T.length },
    { label: 'Created an agent', n: T.filter((t) => withAgent.has(t.id)).length },
    { label: 'Handled a real call', n: T.filter((t) => withCall.has(t.id)).length },
    { label: 'Paying', n: T.filter((t) => paying.has(t.id)).length },
  ];
  const mcpKeys = keys.data || [];
  const byClient = new Map<string, number>();
  for (const k of mcpKeys) if (!k.revoked_at) byClient.set(k.name, (byClient.get(k.name) || 0) + 1);

  const stats = [
    { k: 'Workspaces', v: T.length },
    { k: 'Active in last 7 days', v: active7.size },
    { k: 'Calls (excl. internal tests)', v: C.length },
    { k: 'Minutes handled', v: Math.round(minutes).toLocaleString() },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.k} className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-[13px] text-gray-500">{s.k}</p>
            <p className="mt-1 text-[28px] tracking-tight">{s.v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Bars label="New workspaces" data={bucket(T)} />
        <Bars label="Calls" data={bucket(C)} />
        <Bars label="Minutes" data={bucket(C.map((c) => ({ created_at: c.created_at, s: c.duration_seconds || 0 })), ((r: { s: number }) => r.s / 60) as never)} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-medium">Activation funnel</h2>
        <ul className="mt-4 space-y-3">
          {funnel.map((f) => (
            <li key={f.label}>
              <div className="flex justify-between text-[14px]"><span>{f.label}</span><span className="tabular-nums text-gray-500">{f.n}{funnel[0].n ? ` (${Math.round((f.n / funnel[0].n) * 100)}%)` : ''}</span></div>
              <div className="mt-1 h-2 rounded bg-gray-100"><div className="h-2 rounded bg-[#00122e]" style={{ width: `${funnel[0].n ? (f.n / funnel[0].n) * 100 : 0}%` }} /></div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] text-gray-400">Workspaces include ones created by the demo wizard and our own test accounts, so early numbers are noisy.</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-medium">MCP connections</h2>
        <p className="mt-1 text-[13px] text-gray-500">{(clients.data || []).length} client registrations, {mcpKeys.filter((k) => !k.revoked_at).length} active connections</p>
        <ul className="mt-3 divide-y divide-gray-100 text-[14px]">
          {[...byClient.entries()].map(([name, n]) => (
            <li key={name} className="flex justify-between py-2"><span>{name.replace('MCP: ', '')}</span><span className="tabular-nums text-gray-500">{n}</span></li>
          ))}
          {!byClient.size && <li className="py-2 text-gray-400">No connections yet</li>}
        </ul>
      </div>
      <p className="text-[12px] text-gray-400">Website visitors and page views live in PostHog.</p>
    </div>
  );
}
