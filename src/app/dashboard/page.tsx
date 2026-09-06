'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/context/OnboardingContext';
import { api, type CallLog } from '@/lib/api';
import { formatPhoneDisplay, formatDuration, formatRelativeTime } from '@/lib/utils';

export default function DashboardPage() {
  const { tenantId, isHydrated } = useOnboarding();
  const [stats, setStats] = useState({ totalCalls: 0, todayCalls: 0, totalBookings: 0, avgDuration: 0 });
  const [recentCalls, setRecentCalls] = useState<CallLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!tenantId || !isHydrated) return;

      setIsLoading(true);
      try {
        const [statsData, callsData] = await Promise.all([
          api.getCallStats(tenantId),
          api.getCallLogs(tenantId, 5),
        ]);
        setStats(statsData);
        setRecentCalls(callsData);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [tenantId, isHydrated]);

  return (
    <>
      <h1 className="mb-6 text-[22px] font-semibold text-[#1a1d29]">Overview</h1>

      {/* Stats Grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Calls" value={stats.totalCalls.toString()} />
        <StatCard label="Calls Today" value={stats.todayCalls.toString()} />
        <StatCard label="Total Bookings" value={stats.totalBookings.toString()} />
        <StatCard label="Avg Duration" value={formatDuration(stats.avgDuration)} />
      </div>

      {/* Recent Calls */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-[#1a1d29]">Recent Calls</h2>
          <Link href="/dashboard/calls" className="text-[13px] font-medium text-blue-600 hover:text-blue-700">
            View all
          </Link>
        </div>
        {isLoading ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">Loading…</div>
        ) : recentCalls.length === 0 ? (
          <div className="p-10 text-center text-[13.5px] text-gray-400">
            No calls yet. Your AI receptionist is ready to answer!
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentCalls.map((call) => (
              <Link
                key={call.id}
                href={`/dashboard/calls/${call.id}`}
                className="flex items-center justify-between px-5 py-3.5 transition hover:bg-gray-50/70"
              >
                <div>
                  <p className="text-[13.5px] font-medium text-[#1a1d29]">{formatPhoneDisplay(call.caller_phone)}</p>
                  <p className="mt-0.5 text-[12px] text-gray-400">{formatRelativeTime(call.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12.5px] text-gray-500">{formatDuration(call.duration_seconds)}</span>
                  <OutcomeBadge outcome={call.outcome} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <QuickAction
          href="/dashboard/knowledge"
          icon={<IconBook />}
          title="Add Knowledge"
          description="Help your AI answer customer questions"
        />
        <QuickAction
          href="/dashboard/settings"
          icon={<IconCalendar />}
          title="Connect Calendar"
          description="Enable real-time appointment booking"
        />
        <QuickAction
          href="/demo"
          icon={<IconPhone />}
          title="Test Call"
          description="Make a test call to your AI receptionist"
        />
      </div>
    </>
  );
}

function StatCard({ label, value, trend }: { label: string; value: string; trend?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="mb-1.5 text-[12.5px] text-gray-500">{label}</p>
      <div className="flex items-end gap-2">
        <p className="text-[26px] font-semibold leading-none text-[#1a1d29]">{value}</p>
        {trend && <span className="mb-0.5 text-[12.5px] text-green-600">{trend}</span>}
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const colors: Record<string, string> = {
    booked: 'bg-green-50 text-green-700',
    answered: 'bg-blue-50 text-blue-700',
    transferred: 'bg-amber-50 text-amber-700',
    voicemail: 'bg-gray-100 text-gray-600',
    abandoned: 'bg-red-50 text-red-700',
  };

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${colors[outcome] || colors.answered}`}>
      {outcome}
    </span>
  );
}

function QuickAction({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-sm"
    >
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-500">{icon}</div>
      <h3 className="text-[13.5px] font-semibold text-[#1a1d29]">{title}</h3>
      <p className="mt-0.5 text-[12.5px] text-gray-500">{description}</p>
    </Link>
  );
}

function IconBook() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" />
    </svg>
  );
}
