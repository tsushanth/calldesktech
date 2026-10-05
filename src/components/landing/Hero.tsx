'use client';

import { useCallback, useState } from 'react';
import { GlassButton } from './primitives';
import { MESH } from './gradient';
import { HERO_SCENARIOS } from '@/lib/heroScenarios';
import { clipForDay, hasClips } from '@/lib/heroPool';
import { useToday } from '@/lib/useToday';
import { useLiveDemo } from '@/lib/useLiveDemo';
import { track } from '@/components/Analytics';
import { HeroCallPanel } from './HeroCallPanel';
import { HERO_PRICE_LINE, HERO_PRICE_QUALIFIER } from '@/lib/pricingCopy';

/**
 * Hero: the headline rotates through example calls, and the call panel beside
 * it is both the example and the real thing. It plays the current example, and
 * when a visitor types or presses the mic the same panel becomes a live call
 * with the agent. "Set up your own agent" goes to the full setup demo.
 */

const RUNS_ON = ['Twilio', 'Deepgram', 'Anthropic Claude', 'Cal.com', 'ElevenLabs', 'Cartesia'];

export function Hero() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const live = useLiveDemo();
  const inCall = live.status === 'connecting' || live.status === 'live' || live.status === 'ended';
  const day = useToday();
  // The order of the examples, and the footage for each, change every day.
  const scenarios = day === null ? HERO_SCENARIOS : [...HERO_SCENARIOS.slice(day % HERO_SCENARIOS.length), ...HERO_SCENARIOS.slice(0, day % HERO_SCENARIOS.length)];
  const scenario = scenarios[active];
  const clip = day === null ? null : clipForDay(scenario.id, day);

  const next = useCallback(() => setActive((i) => (i + 1) % HERO_SCENARIOS.length), []);
  const choose = (i: number) => {
    setActive(i);
    track('hero_scenario_selected', { scenario: scenarios[i].id });
  };

  const tabs = (extra: string) => (
    <div role="tablist" aria-label="Example calls" className={`flex flex-wrap gap-2 ${extra} ${inCall ? 'opacity-40' : ''}`}>
      {scenarios.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={i === active}
          onClick={() => choose(i)}
          className={`rounded-full border px-4 py-2 text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
            i === active ? 'border-white bg-white text-[#00122e]' : 'border-white/30 bg-white/10 text-white/90 hover:bg-white/20'
          }`}
        >
          {s.tab}
        </button>
      ))}
    </div>
  );

  return (
    <section className="px-2 pt-[72px]">
      <div className="relative isolate overflow-hidden rounded-[28px] text-white" style={{ background: '#0a2a86' }}>
        <div aria-hidden className="mesh-drift absolute -inset-[8%] -z-10" style={{ background: MESH }} />

        <div className="mx-auto grid max-w-[1160px] grid-cols-1 items-center gap-10 px-6 pb-14 pt-14 md:min-h-[700px] md:grid-cols-[1.02fr_0.98fr] md:gap-14 md:pb-16 md:pt-20">
          <div className="min-w-0">
            <h1
              key={inCall ? 'live' : scenario.id}
              className="hero-swap font-[family-name:var(--font-serif)] text-[46px] font-normal leading-[0.98] tracking-[-0.035em] sm:text-[60px] md:text-[78px]"
            >
              {inCall ? 'Talk to it like a caller would.' : scenario.headline}
            </h1>
            <p className="mt-6 max-w-[480px] text-[17px] leading-[1.5] text-white/80 md:text-[18px]">
              {inCall
                ? 'Tell it what kind of business you run and it will answer the phone as that business.'
                : 'An AI receptionist for your business phone. It answers questions, books appointments, transfers callers and takes messages.'}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => live.start({ mic: true })}
                disabled={live.status === 'connecting' || live.status === 'live'}
                className="inline-flex items-center justify-center rounded-md bg-white px-6 py-3.5 text-[15px] font-medium text-[#00122e] transition-colors hover:bg-[#f0f0f8] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Talk to it now
              </button>
              <GlassButton href="/demo" size="lg">Set up your own agent</GlassButton>
            </div>

            <div className="mt-5 max-w-[480px]" data-testid="hero-price">
              <p className="text-[15px] font-medium leading-[1.4] text-white">
                {HERO_PRICE_LINE}{' '}
                <a href="/pricing" className="whitespace-nowrap underline underline-offset-4 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">See pricing</a>
              </p>
              <p className="mt-1 text-[12.5px] leading-[1.45] text-white/65">{HERO_PRICE_QUALIFIER}</p>
            </div>

            {tabs('mt-10 hidden md:flex')}
          </div>

          <div
            className="min-w-0"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <HeroCallPanel scenario={scenario} clip={clip} hasFootage={hasClips(scenario.id)} paused={paused} onFinishedExample={next} live={live} />
            {tabs('mt-5 md:hidden')}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1160px] px-6 py-10 md:py-14">
        <p className="text-center text-[13px] text-gray-500">Runs on the telephony, speech and language tools it is built with</p>
        <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-[20px] font-medium tracking-[-0.03em] text-[#00122e]/55 md:gap-x-14 md:text-[24px]">
          {RUNS_ON.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
