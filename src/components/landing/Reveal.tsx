'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Scroll-reveal wrapper.
 *
 * Ports the one behavior worth taking from retellai.com's scroll sweep: cards
 * begin offset downward and settle as the section enters the viewport
 * (measured there as translateY(330px) -> 0). We use a much smaller 24px
 * offset — their large travel works against full-bleed art, not text cards —
 * with their signature easing, cubic-bezier(0.22, 1, 0.36, 1).
 *
 * No animation library: one IntersectionObserver + a CSS transition.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  /** Stagger offset in ms. Siblings typically step by 60ms. */
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect reduced-motion: show immediately, never animate.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      // Fire slightly before the element is fully on screen so the motion
      // reads as "settling into place", not "popping in late".
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 }
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(24px)',
        transition:
          'opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1), transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
        transitionDelay: `${delay}ms`,
        willChange: shown ? 'auto' : 'opacity, transform',
      }}
    >
      {children}
    </Tag>
  );
}
