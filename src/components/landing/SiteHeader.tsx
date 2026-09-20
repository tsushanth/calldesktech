'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const NAV_LINKS = [
  { href: '/#templates', label: 'Templates' },
  { href: '/#platform', label: 'Platform' },
  { href: '/#capabilities', label: 'Capabilities' },
  { href: '/#developers', label: 'Developers' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/docs', label: 'API docs' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/partners', label: 'Partners' },
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
      className={`fixed top-0 left-0 right-0 z-50 h-[72px] flex items-center bg-white transition-[border-color] duration-300 ${
        scrolled ? 'border-b border-gray-200' : 'border-b border-transparent'
      }`}
    >
      <nav className="mx-auto w-full max-w-[1160px] px-6 flex items-center justify-between">
        <Link
          href="/"
          className="text-[18px] font-semibold tracking-[-0.04em] text-[#00122e]"
        >
          CallDeskTech
        </Link>

        <div className="hidden lg:flex items-center gap-7 text-[13px] font-medium text-[#00122e]">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="tracking-[-0.01em] hover:text-blue-600 transition-colors duration-150"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/auth/login"
            className="hidden sm:block text-[13px] font-medium text-[#00122e] hover:text-blue-600 px-3 py-2 transition-colors duration-150"
          >
            Sign in
          </Link>
          <Link
            href="/demo"
            className="text-[13px] font-medium text-white bg-[#00122e] hover:bg-[#0a2450] px-4 py-2 rounded-md transition-[opacity,transform,background-color] duration-150 hover:-translate-y-px active:translate-y-0"
          >
            Try free demo
          </Link>
        </div>
      </nav>
    </header>
  );
}
