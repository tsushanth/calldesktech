'use client';

import Link from 'next/link';
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
  const { businessName, assignedPhoneNumber, isHydrated } = useOnboarding();

  const displayName = businessName || 'My Business';
  const displayPhone = assignedPhoneNumber ? formatPhoneDisplay(assignedPhoneNumber) : 'No number assigned';
  const isActive = !!assignedPhoneNumber;

  const navItems = [
    { href: '/dashboard', icon: '📊', label: 'Overview', exact: true },
    { href: '/dashboard/calls', icon: '📞', label: 'Call Logs' },
    { href: '/dashboard/knowledge', icon: '🧠', label: 'Knowledge Base' },
    { href: '/dashboard/settings', icon: '⚙️', label: 'Settings' },
  ];

  const isActiveLink = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-900 text-white">
        {/* Sidebar */}
        <aside className="fixed left-0 top-0 h-full w-64 bg-gray-800 border-r border-gray-700 p-6">
          <Link href="/" className="text-xl font-bold mb-8 block">
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
        <main className="ml-64 p-8">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
