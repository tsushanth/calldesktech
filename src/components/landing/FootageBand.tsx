import { LightButton, GlassButton } from './primitives';
import { Reveal } from './Reveal';
import { DailyFootage } from './DailyFootage';

/**
 * One full-width moment in a page that is otherwise cards: a shop owner who would
 * have missed the call. The footage changes daily.
 */
export function FootageBand() {
  return (
    <section className="px-2 py-4 md:py-8">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-[28px] text-white">
          <DailyFootage scenario="owner" className="absolute inset-0 -z-10 h-full w-full" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-[#00122e]/90 via-[#00122e]/60 to-[#00122e]/10 md:via-[#00122e]/45" />
          <div className="mx-auto flex min-h-[380px] max-w-[1160px] flex-col justify-end px-6 py-12 md:min-h-[480px] md:py-16">
            <h2 className="max-w-[560px] font-[family-name:var(--font-serif)] text-[38px] font-normal leading-[1] tracking-[-0.03em] md:text-[64px]">
              Your hands are full. The phone does not have to wait.
            </h2>
            <p className="mt-5 max-w-[440px] text-[16px] leading-[1.5] text-white/85">
              It answers, books, transfers and takes messages while you keep working.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <LightButton href="/demo" size="lg">Hear it handle a call</LightButton>
              <GlassButton href="/pricing" size="lg">See pricing</GlassButton>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
