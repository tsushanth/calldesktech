import Link from 'next/link';
import { LightButton, GlassButton } from './primitives';
import { Reveal } from './Reveal';
import { MESH, ORB } from './gradient';
import { Icons, type IconName } from './icons';

/**
 * Hero: a large rounded gradient card under the header, serif headline centred,
 * a live-demo card bottom-right, and (in place of a customer-logo band, which
 * we have no honest content for) a strip naming the technology the product runs on.
 */

const CAPABILITIES: { icon: IconName; label: string }[] = [
  { icon: 'chat', label: 'Answers FAQs' },
  { icon: 'calendar', label: 'Books appointments' },
  { icon: 'transfer', label: 'Transfers calls' },
  { icon: 'note', label: 'Takes messages' },
];

const RUNS_ON = ['Twilio', 'Deepgram', 'Anthropic Claude', 'Cal.com', 'ElevenLabs', 'Cartesia'];

export function Hero() {
  return (
    <section className="px-2 pt-[72px]">
      <div className="relative isolate overflow-hidden rounded-[28px] text-white" style={{ background: '#0a2a86' }}>
        <div aria-hidden className="mesh-drift absolute -inset-[8%] -z-10" style={{ background: MESH }} />

        <div className="mx-auto flex min-h-[640px] max-w-[1160px] flex-col items-center px-6 pb-10 pt-20 text-center md:min-h-[760px] md:pt-28">
          <Reveal>
            <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-white/85 md:text-[14px]">
              Voice agents for phone calls
            </p>
          </Reveal>
          <Reveal delay={60}>
            <h1 className="mt-8 font-[family-name:var(--font-serif)] text-[54px] font-normal leading-[0.94] tracking-[-0.035em] sm:text-[76px] md:text-[104px]">
              Your phone,
              <br />
              finally handled.
            </h1>
          </Reveal>
          <Reveal delay={120}>
            <p className="mx-auto mt-8 max-w-[560px] text-[17px] leading-[1.5] text-white/80 md:text-[18px]">
              Answer questions, book appointments, transfer callers or take a message. Start from a template, hear it work in under a minute, and go live today.
            </p>
          </Reveal>
          <Reveal delay={180}>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <LightButton href="/demo" size="lg">Try free demo</LightButton>
              <GlassButton href="/pricing" size="lg">See pricing</GlassButton>
            </div>
          </Reveal>

          <div className="mt-auto flex w-full flex-col items-stretch justify-between gap-6 pt-16 md:flex-row md:items-end">
            <ul className="flex flex-wrap justify-center gap-2 md:justify-start">
              {CAPABILITIES.map((cap) => {
                const Icon = Icons[cap.icon];
                return (
                  <li key={cap.label} className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-[13px] text-white/90 backdrop-blur">
                    <Icon className="h-4 w-4 shrink-0" />
                    {cap.label}
                  </li>
                );
              })}
            </ul>
            <Link
              href="/demo"
              className="group mx-auto flex w-full max-w-[300px] items-center justify-between gap-4 rounded-2xl border border-white/25 bg-white/10 p-3 pl-5 text-left text-[18px] leading-[1.15] tracking-[-0.02em] text-white backdrop-blur transition-colors hover:bg-white/20 md:mx-0"
            >
              Try our live
              <br />
              demo
              <span aria-hidden className="h-[64px] w-[64px] shrink-0 rounded-xl" style={{ background: ORB }} />
            </Link>
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
