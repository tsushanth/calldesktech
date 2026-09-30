'use client';

import { clipForDay } from '@/lib/heroPool';
import { useToday } from '@/lib/useToday';
import { usePrefersReducedMotion } from './HeroCallPanel';

/**
 * Muted, looping footage from the clip pool. Shows the clip for today's date (so
 * it changes daily) and only fetches one file. Decorative: hidden from assistive
 * technology, and reduced-motion visitors get the still poster. The caller sets the
 * position and size (for example `relative aspect-[4/3]` or `absolute inset-0`).
 */
export function DailyFootage({ scenario, className = '', salt = 0 }: { scenario: string; className?: string; salt?: number }) {
  const day = useToday();
  const reduced = usePrefersReducedMotion();
  const clip = day === null ? null : clipForDay(scenario, day + salt);

  return (
    <div aria-hidden className={`overflow-hidden bg-[#00122e] ${className}`}>
      {clip &&
        (reduced ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.poster} alt="" className="h-full w-full object-cover" />
        ) : (
          <video
            key={clip.id}
            src={clip.video}
            poster={clip.poster}
            className="hero-swap h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            tabIndex={-1}
          />
        ))}
    </div>
  );
}
