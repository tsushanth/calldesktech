'use client';

import { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type AnalyticsResponse, type CallOutcome } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

// Chart chrome — kept in sync with the dashboard's light theme (#1a1d29 ink,
// gray-200 borders) and the dataviz palette (recessive grid/axes, one hue per
// series). No default Recharts blue-on-white look.
const AXIS = '#898781'; // muted axis/label ink
const GRID = '#eef0f2'; // hairline gridline
const ACCENT = '#2563eb'; // blue-600, the app accent

// Outcome colors mirror the OutcomeBadge semantics used across the dashboard
// (booked=green, answered=blue, transferred=amber, voicemail=gray,
// abandoned=red), stepped to the dataviz categorical hues for CVD safety.
const OUTCOME_COLOR: Record<CallOutcome, string> = {
  booked: '#1baf7a',
  answered: '#2a78d6',
  transferred: '#eda100',
  voicemail: '#898781',
  abandoned: '#e34948',
};

const OUTCOME_LABEL: Record<CallOutcome, string> = {
  booked: 'Booked',
  answered: 'Answered',
  transferred: 'Transferred',
  voicemail: 'Voicemail',
  abandoned: 'Abandoned',
};

function formatDayShort(iso: string): string {
  // iso is YYYY-MM-DD (UTC) — render in UTC to match the server's bucketing.
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatHour(hour: number): string {
  const period = hour < 12 ? 'a' : 'p';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${period}`;
}

export default function AnalyticsPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!tenantId || !isHydrated) return;
      setIsLoading(true);
      try {
        setData(await api.getAnalytics(tenantId));
      } catch (err) {
        console.error('Failed to load analytics:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [tenantId, isHydrated]);

  const totalCalls = data?.totalCalls ?? 0;
  const totalBooked = data?.outcomes.find((o) => o.outcome === 'booked')?.count ?? 0;
  const bookingRate = totalCalls > 0 ? Math.round((totalBooked / totalCalls) * 100) : 0;
  const answeredCalls = data
    ? data.outcomes.filter((o) => o.outcome !== 'abandoned').reduce((s, o) => s + o.count, 0)
    : 0;
  const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
  // Overall mean = sum of each day's (avg × count) / total calls. Since each
  // day's avg × count is that day's total duration, this recovers the true
  // overall average without re-fetching per-call rows.
  const avgDurationAll = data
    ? (() => {
        const totalDuration = data.volume.reduce((acc, v, i) => {
          const dur = data.duration[i]?.avgDuration;
          return dur != null ? acc + dur * v.calls : acc;
        }, 0);
        return totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
      })()
    : 0;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-[#1a1d29]">Analytics</h1>
        <p className="mt-1 text-[13px] text-gray-500">Call performance over the last 30 days.</p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-16 text-center text-[13.5px] text-gray-400">
          Loading analytics…
        </div>
      ) : !data || totalCalls === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-16 text-center text-[13.5px] text-gray-400">
          No call data in the last 30 days yet. Analytics will populate as your AI receptionist takes calls.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Total Calls" value={totalCalls.toLocaleString()} />
            <StatCard label="Booking Rate" value={`${bookingRate}%`} />
            <StatCard label="Answer Rate" value={`${answerRate}%`} />
            <StatCard label="Avg Duration" value={formatDuration(avgDurationAll)} />
          </div>

          {/* Call volume */}
          <ChartCard title="Call Volume" subtitle="Calls per day">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.volume} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDayShort}
                  tick={{ fill: AXIS, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  minTickGap={28}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: AXIS, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  content={<VolumeTooltip />}
                  cursor={{ stroke: GRID, strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="calls"
                  stroke={ACCENT}
                  strokeWidth={2}
                  fill="url(#volumeFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: ACCENT, stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Outcome breakdown */}
            <ChartCard title="Outcome Breakdown" subtitle="Where calls end up">
              <div className="flex flex-col items-center gap-6 sm:flex-row">
                <div className="relative h-[200px] w-[200px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.outcomes.filter((o) => o.count > 0)}
                        dataKey="count"
                        nameKey="outcome"
                        cx="50%"
                        cy="50%"
                        innerRadius={62}
                        outerRadius={92}
                        paddingAngle={2}
                        stroke="#fff"
                        strokeWidth={2}
                      >
                        {data.outcomes
                          .filter((o) => o.count > 0)
                          .map((o) => (
                            <Cell key={o.outcome} fill={OUTCOME_COLOR[o.outcome]} />
                          ))}
                      </Pie>
                      <Tooltip content={<OutcomeTooltip total={totalCalls} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[24px] font-semibold leading-none text-[#1a1d29]">
                      {totalCalls.toLocaleString()}
                    </span>
                    <span className="mt-1 text-[11px] text-gray-500">total calls</span>
                  </div>
                </div>
                <div className="w-full space-y-2">
                  {data.outcomes.map((o) => {
                    const pct = totalCalls > 0 ? Math.round((o.count / totalCalls) * 100) : 0;
                    return (
                      <div key={o.outcome} className="flex items-center gap-2.5 text-[13px]">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: OUTCOME_COLOR[o.outcome] }}
                        />
                        <span className="text-gray-600">{OUTCOME_LABEL[o.outcome]}</span>
                        <span className="ml-auto font-medium tabular-nums text-[#1a1d29]">{o.count}</span>
                        <span className="w-9 text-right text-[12px] tabular-nums text-gray-400">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ChartCard>

            {/* Calls by hour */}
            <ChartCard title="Calls by Hour" subtitle="Busiest times of day (UTC)">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.byHour} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tickFormatter={formatHour}
                    tick={{ fill: AXIS, fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: GRID }}
                    interval={2}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: AXIS, fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip content={<HourTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
                  <Bar dataKey="calls" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Average duration trend */}
          <ChartCard title="Average Call Duration" subtitle="Mean call length per day">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.duration} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDayShort}
                  tick={{ fill: AXIS, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  minTickGap={28}
                />
                <YAxis
                  tickFormatter={(s: number) => formatDuration(s)}
                  tick={{ fill: AXIS, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip content={<DurationTooltip />} cursor={{ stroke: GRID, strokeWidth: 1 }} />
                <Line
                  type="monotone"
                  dataKey="avgDuration"
                  stroke={ACCENT}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: ACCENT, stroke: '#fff', strokeWidth: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="mb-1.5 text-[12.5px] text-gray-500">{label}</p>
      <p className="text-[26px] font-semibold leading-none text-[#1a1d29]">{value}</p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4">
        <h2 className="text-[14px] font-semibold text-[#1a1d29]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Tooltips ────────────────────────────────────────────────────────────────
// Styled to match the light theme instead of the default Recharts white box.

function TooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-sm">
      {children}
    </div>
  );
}

interface TooltipPayload<T> {
  active?: boolean;
  payload?: Array<{ payload: T }>;
}

function VolumeTooltip({ active, payload }: TooltipPayload<{ date: string; calls: number }>) {
  if (!active || !payload?.length) return null;
  const { date, calls } = payload[0].payload;
  return (
    <TooltipShell>
      <p className="mb-0.5 text-gray-500">{formatDayShort(date)}</p>
      <p className="font-medium text-[#1a1d29]">
        {calls} {calls === 1 ? 'call' : 'calls'}
      </p>
    </TooltipShell>
  );
}

function DurationTooltip({
  active,
  payload,
}: TooltipPayload<{ date: string; avgDuration: number | null }>) {
  if (!active || !payload?.length) return null;
  const { date, avgDuration } = payload[0].payload;
  return (
    <TooltipShell>
      <p className="mb-0.5 text-gray-500">{formatDayShort(date)}</p>
      <p className="font-medium text-[#1a1d29]">
        {avgDuration != null ? `${formatDuration(avgDuration)} avg` : 'No calls'}
      </p>
    </TooltipShell>
  );
}

function HourTooltip({ active, payload }: TooltipPayload<{ hour: number; calls: number }>) {
  if (!active || !payload?.length) return null;
  const { hour, calls } = payload[0].payload;
  return (
    <TooltipShell>
      <p className="mb-0.5 text-gray-500">{formatHour(hour)} (UTC)</p>
      <p className="font-medium text-[#1a1d29]">
        {calls} {calls === 1 ? 'call' : 'calls'}
      </p>
    </TooltipShell>
  );
}

function OutcomeTooltip({
  active,
  payload,
  total,
}: TooltipPayload<{ outcome: CallOutcome; count: number }> & { total: number }) {
  if (!active || !payload?.length) return null;
  const { outcome, count } = payload[0].payload;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <TooltipShell>
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: OUTCOME_COLOR[outcome] }}
        />
        <span className="text-gray-600">{OUTCOME_LABEL[outcome]}</span>
        <span className="ml-2 font-medium text-[#1a1d29]">
          {count} ({pct}%)
        </span>
      </div>
    </TooltipShell>
  );
}
