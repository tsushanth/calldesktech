import { Container, PrimaryButton, SecondaryButton } from './primitives';
import { Reveal } from './Reveal';
import { Icons, type IconName } from './icons';

/**
 * Hero.
 *
 * Content is unchanged from the previous landing page — this app's own
 * positioning copy. What changed is the type treatment: the reference site's
 * hero runs ~90px display type at line-height 0.95 and tracking -0.02em, and
 * its section headings drop to weight 400 with -0.06em tracking. The previous
 * version used bold weights at default tracking, which is the main reason it
 * read flatter than the reference.
 */

const CAPABILITIES: { icon: IconName; label: string }[] = [
  { icon: 'chat', label: 'Answers FAQs' },
  { icon: 'calendar', label: 'Books appointments' },
  { icon: 'transfer', label: 'Transfers calls' },
  { icon: 'note', label: 'Takes messages' },
];

export function Hero() {
  return (
    <section className="relative pt-[152px] pb-20 md:pt-[184px] md:pb-[120px]">
      {/* Ambient glow — replaces the reference's full-bleed hero artwork, which
          we have no equivalent asset for. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[620px] opacity-70"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 0%, rgba(37,99,235,0.20) 0%, rgba(37,99,235,0.06) 40%, transparent 72%)',
        }}
      />

      <Container className="relative">
        <div className="mx-auto max-w-[820px] text-center">
          <Reveal>
            <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-blue-400">
              AI receptionist, built from real capabilities
            </p>
          </Reveal>

          <Reveal delay={60}>
            <h1
              className="mt-7 text-[46px] leading-[0.98] tracking-[-0.02em] text-white sm:text-[64px] md:text-[86px]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Your phone,
              <br />
              <span className="italic text-blue-400">finally handled.</span>
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mx-auto mt-7 max-w-[560px] text-[17px] leading-[1.5] text-gray-400 md:text-[18px]">
              Answer questions, book appointments, transfer callers, or take a
              message — pick what your business needs, hear it work in under a
              minute, and go live today.
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <PrimaryButton href="/demo" size="lg">
                Try free demo
              </PrimaryButton>
              <SecondaryButton href="/pricing" size="lg">
                See pricing
              </SecondaryButton>
            </div>
          </Reveal>
        </div>

        {/*
          The reference site puts a customer-logo band directly below the hero.
          This product has no public customers yet, so rather than fabricate a
          logo wall we occupy that structural slot with the four capabilities a
          visitor can actually go and hear demoed. Same rhythm, honest content.
        */}
        <div className="mx-auto mt-16 grid max-w-[900px] grid-cols-2 gap-3 md:mt-20 md:grid-cols-4">
          {CAPABILITIES.map((cap, i) => (
            <Reveal key={cap.label} delay={240 + i * 60}>
              <div className="flex items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-4 text-[14px] tracking-[-0.01em] text-gray-300 transition-colors duration-300 hover:border-white/20">
                {(() => {
                  const Icon = Icons[cap.icon];
                  return <Icon className="h-4 w-4 shrink-0 text-blue-400" />;
                })()}
                <span>{cap.label}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
