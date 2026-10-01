import { getSupabaseAdmin } from '@/lib/supabase';
import { adminEmails } from '@/lib/outreach/config';
import type { Check } from './health';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export interface Overview {
  totals: { users: number; workspaces: number; agents: number; callsAllTime: number };
  calls: { h24: number; d7: number; d30: number; minutes7: number; lastCallAt: string | null; byOutcome: Record<string, number> };
  signupsByDay: { d: string; v: number }[];
  sms: { h24: number; failed24: number };
  outreach: { lastSentAt: string | null; approvedQueue: number; sent7: number; hardBounces7: number; complaints7: number; lastRun: { at: string; status: string; errors: number | null } | null; stuckRuns: number };
  signals: Check[];
}

export const ago = (iso: string | null): string => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export function lastDays(n: number, now = Date.now()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * DAY).toISOString().slice(0, 10));
}

export async function loadOverview(): Promise<Overview> {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const iso = (ms: number) => new Date(now - ms).toISOString();
  const owner = new Set(adminEmails());

  const [users, tenants, agents, calls, sms, sent, queue, events, runs] = await Promise.all([
    db.from('calldesk_users').select('email, created_at').limit(10000),
    db.from('calldesk_tenants').select('id', { count: 'exact', head: true }).not('user_id', 'like', 'demo_%'),
    db.from('calldesk_agents').select('id', { count: 'exact', head: true }),
    db.from('calldesk_call_logs').select('outcome, duration_seconds, created_at').neq('is_internal_test', true).gte('created_at', iso(30 * DAY)).order('created_at', { ascending: false }).limit(20000),
    db.from('calldesk_sms_messages').select('status, created_at').gte('created_at', iso(DAY)).limit(5000),
    db.from('calldesk_outreach_messages').select('sent_at').eq('status', 'sent').gte('sent_at', iso(7 * DAY)).order('sent_at', { ascending: false }).limit(5000),
    db.from('calldesk_outreach_messages').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    db.from('calldesk_outreach_email_events').select('event, detail').in('event', ['bounced', 'complained']).gte('occurred_at', iso(7 * DAY)).limit(2000),
    db.from('calldesk_outreach_runs').select('started_at, status, errors').order('started_at', { ascending: false }).limit(20),
  ]);

  const U = ((users.data || []) as { email: string; created_at: string }[]).filter((u) => !owner.has((u.email || '').toLowerCase()));
  const C = (calls.data || []) as { outcome: string | null; duration_seconds: number | null; created_at: string }[];
  const inWin = (t: string, ms: number) => t >= iso(ms);

  const byOutcome: Record<string, number> = {};
  for (const c of C) if (inWin(c.created_at, 7 * DAY)) byOutcome[c.outcome || 'unknown'] = (byOutcome[c.outcome || 'unknown'] || 0) + 1;

  const days = lastDays(14, now);
  const signups = new Map(days.map((d) => [d, 0]));
  for (const u of U) { const k = u.created_at.slice(0, 10); if (signups.has(k)) signups.set(k, (signups.get(k) || 0) + 1); }

  const S = (sms.data || []) as { status: string }[];
  const ev = (events.data || []) as { event: string; detail?: { type?: string } | null }[];
  const runRows = (runs.data || []) as { started_at: string; status: string; errors: number | null }[];
  const run = runRows[0];
  const sentRows = (sent.data || []) as { sent_at: string }[];

  return {
    totals: { users: U.length, workspaces: tenants.count ?? 0, agents: agents.count ?? 0, callsAllTime: C.length },
    calls: {
      h24: C.filter((c) => inWin(c.created_at, DAY)).length,
      d7: C.filter((c) => inWin(c.created_at, 7 * DAY)).length,
      d30: C.length,
      minutes7: Math.round(C.filter((c) => inWin(c.created_at, 7 * DAY)).reduce((a, c) => a + (c.duration_seconds || 0), 0) / 60),
      lastCallAt: C[0]?.created_at ?? null,
      byOutcome,
    },
    signupsByDay: days.map((d) => ({ d, v: signups.get(d) || 0 })),
    sms: { h24: S.length, failed24: S.filter((m) => ['failed', 'undelivered'].includes(m.status)).length },
    outreach: {
      lastSentAt: sentRows[0]?.sent_at ?? null,
      approvedQueue: queue.count ?? 0,
      sent7: sentRows.length,
      hardBounces7: ev.filter((e) => e.event === 'bounced' && String(e.detail?.type ?? '').toLowerCase() !== 'transient').length,
      complaints7: ev.filter((e) => e.event === 'complained').length,
      lastRun: run ? { at: run.started_at, status: run.status, errors: run.errors } : null,
      stuckRuns: runRows.filter((r) => r.status === 'running' && r.started_at < iso(3 * HOUR)).length,
    },
    signals: [],
  };
}

// Turns raw numbers into plain-language warnings, so the page can lead with what needs attention.
export function attentionItems(o: Overview): string[] {
  const out: string[] = [];
  if (o.outreach.complaints7 > 0) out.push(`${o.outreach.complaints7} spam complaint(s) on outreach in the last 7 days. Autosend pauses itself on this.`);
  if (o.outreach.sent7 >= 20 && o.outreach.hardBounces7 / o.outreach.sent7 >= 0.05) out.push(`Outreach bounce rate is ${Math.round((100 * o.outreach.hardBounces7) / o.outreach.sent7)}% over 7 days.`);
  if (o.sms.failed24 > 0) out.push(`${o.sms.failed24} of ${o.sms.h24} text messages failed in the last 24 hours.`);
  if (o.outreach.stuckRuns > 0) out.push(`${o.outreach.stuckRuns} outreach discovery run(s) have been "running" for over 3 hours and may be stuck.`);
  if (o.outreach.lastRun && /fail|error/i.test(o.outreach.lastRun.status)) out.push(`The last outreach discovery run ended with status "${o.outreach.lastRun.status}".`);
  return out;
}
