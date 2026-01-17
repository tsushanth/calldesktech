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
      <h1 className="text-2xl font-bold mb-8">Dashboard Overview</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <StatCard label="Total Calls" value={stats.totalCalls.toString()} />
        <StatCard label="Calls Today" value={stats.todayCalls.toString()} />
        <StatCard label="Total Bookings" value={stats.totalBookings.toString()} />
        <StatCard label="Avg Duration" value={formatDuration(stats.avgDuration)} />
      </div>

      {/* Recent Calls */}
      <div className="bg-gray-800 rounded-xl border border-gray-700">
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="font-semibold">Recent Calls</h2>
          <Link href="/dashboard/calls" className="text-blue-400 hover:text-blue-300 text-sm">
            View All
          </Link>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : recentCalls.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No calls yet. Your AI receptionist is ready to answer!
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {recentCalls.map((call) => (
              <Link
                key={call.id}
                href={`/dashboard/calls/${call.id}`}
                className="p-4 flex items-center justify-between hover:bg-gray-700/50 block"
              >
                <div>
                  <p className="font-medium">{formatPhoneDisplay(call.caller_phone)}</p>
                  <p className="text-sm text-gray-400">{formatRelativeTime(call.created_at)}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-400">{formatDuration(call.duration_seconds)}</span>
                  <OutcomeBadge outcome={call.outcome} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="mt-8 grid grid-cols-3 gap-6">
        <QuickAction
          href="/dashboard/knowledge"
          icon="🧠"
          title="Add Knowledge"
          description="Help your AI answer customer questions"
        />
        <QuickAction
          href="/dashboard/settings"
          icon="📅"
          title="Connect Calendar"
          description="Enable real-time appointment booking"
        />
        <QuickAction
          href="/demo"
          icon="📞"
          title="Test Call"
          description="Make a test call to your AI receptionist"
        />
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
      <p className="text-gray-400 text-sm mb-2">{label}</p>
      <div className="flex items-end gap-2">
        <p className="text-3xl font-bold">{value}</p>
        {trend && (
          <span className="text-green-400 text-sm mb-1">{trend}</span>
        )}
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const colors: Record<string, string> = {
    booked: 'bg-green-500/20 text-green-400',
    answered: 'bg-blue-500/20 text-blue-400',
    transferred: 'bg-yellow-500/20 text-yellow-400',
    voicemail: 'bg-gray-500/20 text-gray-400',
    abandoned: 'bg-red-500/20 text-red-400',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[outcome] || colors.answered}`}>
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
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="bg-gray-800 rounded-xl border border-gray-700 p-6 hover:border-blue-500/50 transition block"
    >
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-gray-400">{description}</p>
    </Link>
  );
}
