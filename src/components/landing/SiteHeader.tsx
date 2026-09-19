'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const NAV_LINKS = [
  { href: '#templates', label: 'Templates' },
  { href: '#platform', label: 'Platform' },
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#developers', label: 'Developers' },
  { href: '#faq', label: 'FAQ' },
  { href: '/pricing', label: 'Pricing' },
];

/**
 * Fixed 72px header, matching the reference site's measured nav height.
 *
 * Over the light page (matching the dashboard's own reskin) the header starts
 * fully transparent and gains a white/blur backdrop + hairline border past
 * 24px of scroll, so it stays legible over the hero without ever looking like
 * a hard-edged bar at the very top.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 h-[72px] flex items-center transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled
          ? 'bg-white/85 backdrop-blur-xl border-b border-gray-200'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <nav className="mx-auto w-full max-w-[1160px] px-6 flex items-center justify-between">
        <Link
          href="/"
          className="text-[17px] font-semibold tracking-[-0.03em] text-[#1a1d29]"
        >
          CallDeskTech
        </Link>

        <div className="hidden lg:flex items-center gap-7 text-[13px] text-gray-600">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="tracking-[-0.01em] hover:text-[#1a1d29] transition-colors duration-150"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="hidden sm:block text-[13px] text-gray-600 hover:text-[#1a1d29] px-3 py-2 transition-colors duration-150"
          >
            Dashboard
          </Link>
          <Link
            href="/auth/login"
            className="text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md transition-[opacity,transform,background-color] duration-150 hover:-translate-y-px active:translate-y-0"
          >
            Sign In
          </Link>
        </div>
      </nav>
    </header>
  );
}
