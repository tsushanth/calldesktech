'use client';

import { useState } from 'react';
import Link from 'next/link';

// Mock data for demo
const mockTenant = {
  id: '1',
  name: 'Demo Business',
  phoneNumber: '+1 (555) 123-4567',
  isActive: true,
};

const mockStats = {
  totalCalls: 127,
  bookingsToday: 8,
  avgDuration: '2m 34s',
  answerRate: '94%',
};

const mockRecentCalls = [
  { id: '1', caller: '+1 (555) 987-6543', outcome: 'booked', duration: '3:21', time: '2 min ago' },
  { id: '2', caller: '+1 (555) 456-7890', outcome: 'answered', duration: '1:45', time: '15 min ago' },
  { id: '3', caller: '+1 (555) 321-0987', outcome: 'transferred', duration: '0:58', time: '32 min ago' },
  { id: '4', caller: '+1 (555) 654-3210', outcome: 'booked', duration: '4:12', time: '1 hour ago' },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'calls' | 'knowledge' | 'settings'>('overview');

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-gray-800 border-r border-gray-700 p-6">
        <Link href="/" className="text-xl font-bold mb-8 block">
          CallDeskTech
        </Link>

        <nav className="space-y-2">
          <NavItem
            active={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
            icon="📊"
            label="Overview"
          />
          <NavItem
            active={activeTab === 'calls'}
            onClick={() => setActiveTab('calls')}
            icon="📞"
            label="Call Logs"
          />
          <NavItem
            active={activeTab === 'knowledge'}
            onClick={() => setActiveTab('knowledge')}
            icon="🧠"
            label="Knowledge Base"
          />
          <NavItem
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
            icon="⚙️"
            label="Settings"
          />
        </nav>

        <div className="absolute bottom-6 left-6 right-6">
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${mockTenant.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-400">
                {mockTenant.isActive ? 'Live' : 'Offline'}
              </span>
            </div>
            <p className="font-medium">{mockTenant.name}</p>
            <p className="text-sm text-gray-400">{mockTenant.phoneNumber}</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 p-8">
        {activeTab === 'overview' && (
          <>
            <h1 className="text-2xl font-bold mb-8">Dashboard Overview</h1>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-6 mb-8">
              <StatCard label="Total Calls" value={mockStats.totalCalls.toString()} trend="+12%" />
              <StatCard label="Bookings Today" value={mockStats.bookingsToday.toString()} trend="+3" />
              <StatCard label="Avg Duration" value={mockStats.avgDuration} />
              <StatCard label="Answer Rate" value={mockStats.answerRate} trend="+2%" />
            </div>

            {/* Recent Calls */}
            <div className="bg-gray-800 rounded-xl border border-gray-700">
              <div className="p-4 border-b border-gray-700">
                <h2 className="font-semibold">Recent Calls</h2>
              </div>
              <div className="divide-y divide-gray-700">
                {mockRecentCalls.map((call) => (
                  <div key={call.id} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{call.caller}</p>
                      <p className="text-sm text-gray-400">{call.time}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-400">{call.duration}</span>
                      <OutcomeBadge outcome={call.outcome} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'knowledge' && (
          <>
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-2xl font-bold">Knowledge Base</h1>
              <button className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition">
                + Add Knowledge
              </button>
            </div>

            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <p className="text-gray-400 text-center py-8">
                No knowledge base items yet. Add FAQs or connect your website to get started.
              </p>
            </div>
          </>
        )}

        {activeTab === 'calls' && (
          <>
            <h1 className="text-2xl font-bold mb-8">Call Logs</h1>
            <div className="bg-gray-800 rounded-xl border border-gray-700">
              <div className="divide-y divide-gray-700">
                {mockRecentCalls.map((call) => (
                  <div key={call.id} className="p-4 flex items-center justify-between hover:bg-gray-700/50 cursor-pointer">
                    <div>
                      <p className="font-medium">{call.caller}</p>
                      <p className="text-sm text-gray-400">{call.time}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-400">{call.duration}</span>
                      <OutcomeBadge outcome={call.outcome} />
                      <button className="text-blue-400 hover:text-blue-300 text-sm">
                        View Transcript
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'settings' && (
          <>
            <h1 className="text-2xl font-bold mb-8">Settings</h1>

            <div className="space-y-6">
              <SettingsSection title="Business Information">
                <SettingsField label="Business Name" value={mockTenant.name} />
                <SettingsField label="Phone Number" value={mockTenant.phoneNumber} />
              </SettingsSection>

              <SettingsSection title="AI Voice">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-700 rounded-lg p-4 border-2 border-blue-500">
                    <p className="font-medium">Adrian (Male)</p>
                    <p className="text-sm text-gray-400">Professional, friendly</p>
                  </div>
                  <div className="bg-gray-700 rounded-lg p-4 border border-gray-600 hover:border-gray-500 cursor-pointer">
                    <p className="font-medium">Sarah (Female)</p>
                    <p className="text-sm text-gray-400">Warm, conversational</p>
                  </div>
                </div>
              </SettingsSection>

              <SettingsSection title="Calendar Integration">
                <button className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition">
                  Connect Calendar
                </button>
                <p className="text-sm text-gray-400 mt-2">
                  Connect your Google, Outlook, or iCal calendar for real-time availability.
                </p>
              </SettingsSection>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
        active ? 'bg-blue-600' : 'hover:bg-gray-700'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
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
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[outcome] || colors.answered}`}>
      {outcome}
    </span>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
      <h2 className="font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function SettingsField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        defaultValue={value}
        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
      />
    </div>
  );
}
