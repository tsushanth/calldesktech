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
  const { businessName, assignedPhoneNumber, tenantId, setTenantId } = useOnboarding();

  // tenantId only ever got set client-side, during onboarding — a fresh
  // sign-in (or a tenant created directly rather than through the wizard,
  // like the ones seeded for testing) had no way to become "your" active
  // tenant just from logging in. /api/tenants now resolves the real session
  // server-side (previously trusted a spoofable client header), so this
  // looks up your tenant the moment login is the only thing you've done.
  useEffect(() => {
    if (!session?.user || tenantId) return;
    let cancelled = false;
    fetch('/api/tenants')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.tenants?.length) return;
        setTenantId(body.tenants[0].id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, tenantId, setTenantId]);
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

  // Grouped to match how Retell's own console reads: a top-level Home, then
  // named sections for what you build, deploy, and review.
  const navGroups: { label: string | null; items: { href: string; label: string; exact?: boolean }[] }[] = [
    { label: null, items: [{ href: '/dashboard', label: 'Overview', exact: true }] },
    {
      label: 'Build',
      items: [
        { href: '/dashboard/agents', label: 'Agents' },
        { href: '/dashboard/knowledge', label: 'Knowledge Base' },
      ],
    },
    {
      label: 'Deploy',
      items: [
        { href: '/dashboard/numbers', label: 'Phone Numbers' },
        { href: '/dashboard/batch-call', label: 'Batch Call' },
        { href: '/dashboard/integrations', label: 'Integrations' },
      ],
    },
    {
      label: 'Data',
      items: [
        { href: '/dashboard/calls', label: 'Call Logs' },
        { href: '/dashboard/chat-history', label: 'Chat History' },
        { href: '/dashboard/contacts', label: 'Contacts' },
        { href: '/dashboard/analytics', label: 'Analytics' },
      ],
    },
    {
      label: 'Monitor',
      items: [
        { href: '/dashboard/live-monitoring', label: 'Live Monitoring' },
        { href: '/dashboard/quality-assurance', label: 'Quality Assurance' },
        { href: '/dashboard/alerting', label: 'Alerting' },
      ],
    },
    {
      label: 'System',
      items: [
        { href: '/dashboard/billing', label: 'Billing' },
        { href: '/dashboard/settings', label: 'Settings' },
      ],
    },
  ];

  const navIcons: Record<string, React.ReactNode> = {
    '/dashboard': <IconHome />,
    '/dashboard/agents': <IconAgents />,
    '/dashboard/knowledge': <IconBook />,
    '/dashboard/numbers': <IconPhone />,
    '/dashboard/batch-call': <IconBatch />,
    '/dashboard/integrations': <IconIntegrations />,
    '/dashboard/calls': <IconHistory />,
    '/dashboard/chat-history': <IconChat />,
    '/dashboard/contacts': <IconContacts />,
    '/dashboard/analytics': <IconAnalytics />,
    '/dashboard/live-monitoring': <IconMonitor />,
    '/dashboard/quality-assurance': <IconQuality />,
    '/dashboard/alerting': <IconAlert />,
    '/dashboard/billing': <IconBilling />,
    '/dashboard/settings': <IconSettings />,
  };

  const isActiveLink = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
        {/* Mobile top bar — only the toggle + brand; the drawer below carries everything else */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white p-4 md:hidden">
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold text-[#1a1d29]">
            <LogoMark />
            CallDeskTech
          </Link>
          <button
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileNavOpen}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          >
            {mobileNavOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Scrim behind the drawer on mobile */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/30 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {/* Sidebar — an off-canvas drawer below md, a fixed column at md+ */}
        <aside
          className={`fixed left-0 top-0 z-40 flex h-full w-64 transform flex-col border-r border-gray-200 bg-white transition-transform duration-200 md:translate-x-0 ${
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Link href="/" className="hidden items-center gap-2 px-5 pt-5 pb-4 text-[15px] font-semibold text-[#1a1d29] md:flex">
            <LogoMark />
            CallDeskTech
          </Link>

          {/* Workspace switcher-style row — Retell puts the account identity
              right under the logo, not buried at the bottom only. */}
          <div className="mx-3 mb-2 flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] leading-tight text-gray-400">Workspace</p>
              <p className="truncate text-[13px] font-medium leading-tight text-[#1a1d29]">{displayName}</p>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 pb-4">
            {navGroups.map((group, gi) => (
              <div key={gi} className={group.label ? 'mt-4' : ''}>
                {group.label && (
                  <p className="mb-1.5 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActiveLink(item.href, item.exact);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition ${
                          active
                            ? 'bg-blue-50 text-blue-600'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-[#1a1d29]'
                        }`}
                      >
                        <span className={active ? 'text-blue-600' : 'text-gray-400'}>{navIcons[item.href]}</span>
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Status + account, pinned to the bottom */}
          <div className="border-t border-gray-100 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5">
              <span className={`h-1.5 w-1.5 flex-none rounded-full ${isActive ? 'bg-green-500' : 'bg-amber-400'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium leading-tight text-gray-500">
                  {isActive ? 'Live' : 'Setup required'}
                </p>
                <p className="truncate text-[12px] leading-tight text-gray-400">{displayPhone}</p>
              </div>
            </div>

            {session?.user && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600">
                  {(session.user.email || '?').charAt(0).toUpperCase()}
                </div>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-500">{session.user.email}</span>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="flex-none text-[12px] font-medium text-gray-400 hover:text-[#1a1d29]"
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

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="3" fill="currentColor" />
    </svg>
  );
}

function iconProps() {
  return { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
}
function IconHome() { return <svg {...iconProps()}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" /></svg>; }
function IconAgents() { return <svg {...iconProps()}><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><circle cx="9" cy="13.5" r="1" fill="currentColor" /><circle cx="15" cy="13.5" r="1" fill="currentColor" /></svg>; }
function IconBook() { return <svg {...iconProps()}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" /></svg>; }
function IconPhone() { return <svg {...iconProps()}><path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" /></svg>; }
function IconHistory() { return <svg {...iconProps()}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>; }
function IconSettings() { return <svg {...iconProps()}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.2 3.5l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V2a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" /></svg>; }
function IconBatch() { return <svg {...iconProps()}><path d="M6.5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4Z" /><path d="M17 3.5 20 6l-3 2.5" /></svg>; }
function IconIntegrations() { return <svg {...iconProps()}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>; }
function IconChat() { return <svg {...iconProps()}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>; }
function IconContacts() { return <svg {...iconProps()}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 6.5a3 3 0 0 1 0 6" /><path d="M15 14.3a5 5 0 0 1 5.5 5.2" /></svg>; }
function IconAnalytics() { return <svg {...iconProps()}><path d="M4 20V10" /><path d="M11 20V4" /><path d="M18 20v-7" /></svg>; }
function IconMonitor() { return <svg {...iconProps()}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8" /><path d="M12 16v4" /><circle cx="9.5" cy="10" r="1" fill="currentColor" /></svg>; }
function IconQuality() { return <svg {...iconProps()}><path d="M9 12.5 11 14.5 15.5 9" /><circle cx="12" cy="12" r="9" /></svg>; }
function IconAlert() { return <svg {...iconProps()}><path d="M12 4a6 6 0 0 0-6 6v3.5L4 17h16l-2-3.5V10a6 6 0 0 0-6-6Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>; }
function IconBilling() { return <svg {...iconProps()}><rect x="2.5" y="5.5" width="19" height="13" rx="2" /><path d="M2.5 10h19" /><path d="M6 14.5h4" /></svg>; }
