'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useOnboarding } from '@/context/OnboardingContext';
import { formatPhoneDisplay } from '@/lib/utils';
import { AuthGuard } from '@/components/auth/AuthGuard';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { businessName, assignedPhoneNumber, tenantId } = useOnboarding();
  // The sidebar was a fixed 256px column with no breakpoint at all — on a
  // 375px phone it just overflowed the viewport instead of collapsing
  // (found during a mobile-viewport pass that had never been done before).
  // Below md, it becomes an off-canvas drawer toggled by a small top bar.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileNavOpen(false);
  }

  // assignedPhoneNumber is a localStorage-cached leftover from the old
  // single-number onboarding flow — it never gets updated by routing a
  // number on /dashboard/numbers (the agents/versions model), so a tenant
  // routed entirely through that page still showed "No number assigned"
  // here. Source of truth is calldesk_phone_numbers; fall back to the
  // cached value only until that fetch resolves.
  const [routedNumber, setRoutedNumber] = useState<string | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    fetch(`/api/tenants/${tenantId}/phone-numbers`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const first = body.phoneNumbers?.[0]?.number;
        if (first) setRoutedNumber(first);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const effectivePhoneNumber = routedNumber || assignedPhoneNumber;
  const displayName = businessName || 'My Business';
  const displayPhone = effectivePhoneNumber ? formatPhoneDisplay(effectivePhoneNumber) : 'No number assigned';
  const isActive = !!effectivePhoneNumber;

  const navItems = [
    { href: '/dashboard', icon: '📊', label: 'Overview', exact: true },
    { href: '/dashboard/calls', icon: '📞', label: 'Call Logs' },
    { href: '/dashboard/knowledge', icon: '🧠', label: 'Knowledge Base' },
    { href: '/dashboard/agents', icon: '🤖', label: 'Agents' },
    { href: '/dashboard/numbers', icon: '📱', label: 'Phone Numbers' },
    { href: '/dashboard/settings', icon: '⚙️', label: 'Settings' },
  ];

  const isActiveLink = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-900 text-white">
        {/* Mobile top bar — only the toggle + brand; the drawer below carries everything else */}
        <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 p-4 md:hidden">
          <Link href="/" className="text-xl font-bold">
            CallDeskTech
          </Link>
          <button
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileNavOpen}
            className="rounded-lg p-2 hover:bg-gray-700"
          >
            {mobileNavOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Scrim behind the drawer on mobile */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {/* Sidebar — an off-canvas drawer below md, a fixed column at md+ */}
        <aside
          className={`fixed left-0 top-0 z-40 h-full w-64 transform bg-gray-800 border-r border-gray-700 p-6 transition-transform duration-200 md:translate-x-0 ${
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Link href="/" className="mb-8 hidden text-xl font-bold md:block">
            CallDeskTech
          </Link>

          <nav className="space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                isActiveLink(item.href, item.exact) ? 'bg-blue-600' : 'hover:bg-gray-700'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

          {/* User info and sign out */}
          <div className="absolute bottom-6 left-6 right-6">
            <div className="bg-gray-700/50 rounded-lg p-4 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-sm text-gray-400">
                  {isActive ? 'Live' : 'Setup Required'}
                </span>
              </div>
              <p className="font-medium">{displayName}</p>
              <p className="text-sm text-gray-400">{displayPhone}</p>
            </div>

            {session?.user && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 truncate">{session.user.email}</span>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="text-gray-400 hover:text-white ml-2"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="p-4 md:ml-64 md:p-8">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
