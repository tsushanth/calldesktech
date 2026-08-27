'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const NAV_LINKS = [
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#building-blocks', label: 'Building blocks' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#faq', label: 'FAQ' },
  { href: '/pricing', label: 'Pricing' },
];

/**
 * Fixed 72px header, matching the reference site's measured nav height.
 *
 * Deliberate divergence: the reference nav stays fully transparent at every
 * scroll position (sampled at y=0/600/2000 — background, blur and shadow never
 * change). That works over their light page; over this dark gradient the nav
 * would dissolve into the hero. So the header starts near-transparent and
 * gains blur + a hairline border past 24px of scroll.
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
          ? 'bg-gray-900/80 backdrop-blur-xl border-b border-white/10'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <nav className="mx-auto w-full max-w-[1160px] px-6 flex items-center justify-between">
        <Link
          href="/"
          className="text-[17px] font-semibold tracking-[-0.03em] text-white"
        >
          CallDeskTech
        </Link>

        <div className="hidden lg:flex items-center gap-7 text-[13px] text-gray-400">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="tracking-[-0.01em] hover:text-white transition-colors duration-150"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="hidden sm:block text-[13px] text-gray-400 hover:text-white px-3 py-2 transition-colors duration-150"
          >
            Dashboard
          </Link>
          {/* Button metrics ported from the reference: 6px radius, 12-13px
              label at weight 500, and its .15s opacity/transform/bg easing. */}
          <Link
            href="/auth/login"
            className="text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md transition-[opacity,transform,background-color] duration-150 hover:-translate-y-px active:translate-y-0"
          >
            Sign In
          </Link>
        </div>
      </nav>
    </header>
  );
}
