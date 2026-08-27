import Link from 'next/link';
import {
  Container,
  Eyebrow,
  PrimaryButton,
  SecondaryButton,
  Section,
  SectionTitle,
} from './primitives';
import { Reveal } from './Reveal';

/**
 * FAQ, final CTA and footer.
 *
 * The reference site runs a click-driven accordion in this position (measured
 * 20px/-1px headings). We match the structure with native <details>/<summary>
 * so it needs no JavaScript and stays keyboard- and screen-reader-accessible.
 *
 * The reference also runs a testimonial block just above its FAQ. That slot is
 * intentionally left out: this product has no public customers yet, and
 * inventing quotes or logos would be dishonest. The FAQ carries that weight
 * instead, by answering the objections a testimonial would otherwise paper over.
 */

const FAQS = [
  {
    q: 'What happens if the AI cannot answer something?',
    a: 'It transfers to whoever you nominate, or takes a message with the caller’s name, number and reason for calling. It does not invent an answer to fill the gap.',
  },
  {
    q: 'Do I have to replace my current phone number?',
    a: 'No. You can forward the number you already publish, or take a new dedicated one. Forwarding means nothing on your printed material or listings has to change.',
  },
  {
    q: 'Can I hear it before I sign up?',
    a: 'Yes — the live demo runs the real agent, not a recording, and you can try one building block at a time to hear exactly what each one does.',
  },
  {
    q: 'Which calendars does booking work with?',
    a: 'Google Calendar, Outlook and iCal, connected through Cal.com. Availability is read at call time, so it never offers a slot that has already gone.',
  },
  {
    q: 'What does it do outside business hours?',
    a: 'Whatever you configure. Common setups answer questions and take messages overnight, then resume booking and transfers when you open.',
  },
  {
    q: 'Can I turn a capability off later?',
    a: 'Yes. Booking, transfer and message-taking are independent toggles — switching one off does not affect the others and does not require any rebuild.',
  },
];

export function FAQ() {
  return (
    <Section id="faq" size="secondary">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-20">
        <Reveal>
          <div className="lg:sticky lg:top-[104px]">
            <Eyebrow>FAQ</Eyebrow>
            <SectionTitle className="mt-6">
              The questions people
              <br className="hidden md:block" /> ask before switching.
            </SectionTitle>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {FAQS.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-[18px] font-normal leading-[1.3] tracking-[-0.03em] text-white transition-colors duration-150 hover:text-blue-300 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="mt-1 shrink-0 text-gray-500 transition-transform duration-300 group-open:rotate-45"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M8 1v14M1 8h14"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 max-w-[620px] text-[15px] leading-[1.6] text-gray-400">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

export function FinalCTA() {
  return (
    <Section size="secondary">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl border border-white/10 px-8 py-16 text-center md:px-16 md:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              // Centered at 50% 45% (not 50% 0%) with a large enough radius
              // to reach every corner — the original was anchored to the
              // top edge, so the ellipse's lower lobe never reached the
              // card's bottom half, leaving it visibly dead/flat.
              background:
                'radial-gradient(120% 140% at 50% 45%, rgba(37,99,235,0.22) 0%, rgba(37,99,235,0.09) 40%, rgba(37,99,235,0.02) 70%, transparent 100%)',
            }}
          />
          <div className="relative">
            <SectionTitle className="mx-auto max-w-[620px]">
              Hear it handle your first call in under a minute.
            </SectionTitle>
            <p className="mx-auto mt-5 max-w-[500px] text-[16px] leading-[1.55] text-gray-400">
              No install, no card, no sales call. Pick a building block and
              listen to it run.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <PrimaryButton href="/demo" size="lg">
                Try free demo
              </PrimaryButton>
              <SecondaryButton href="/pricing" size="lg">
                See pricing
              </SecondaryButton>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 py-12">
      <Container>
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-[15px] font-semibold tracking-[-0.03em] text-white"
            >
              CallDeskTech
            </Link>
            <span className="text-[13px] text-gray-500">
              © {new Date().getFullYear()}
            </span>
          </div>
          <div className="flex items-center gap-7 text-[13px] text-gray-500">
            <Link
              href="/pricing"
              className="transition-colors duration-150 hover:text-white"
            >
              Pricing
            </Link>
            <Link
              href="/demo"
              className="transition-colors duration-150 hover:text-white"
            >
              Demo
            </Link>
            <Link
              href="/dashboard"
              className="transition-colors duration-150 hover:text-white"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
