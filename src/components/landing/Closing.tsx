import Link from 'next/link';
import {
  Container,
  Eyebrow,
  GlassButton,
  LightButton,
  Section,
  SectionTitle,
} from './primitives';
import { MESH } from './gradient';
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
    q: 'Can I build my own agent instead of using a template?',
    a: 'Yes. Start from a blank flow or from any template, edit the steps and conditions in the visual builder, test it with a call to yourself, then publish. Nothing goes live until you publish a version.',
  },
  {
    q: 'Is there an API?',
    a: 'Yes. Everything in the app is available through a versioned REST API with an OpenAPI description, signed webhooks, and an MCP server for AI assistants. Keys are created in Settings and scoped to one workspace.',
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
          <div className="divide-y divide-gray-200 border-y border-gray-200">
            {FAQS.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-[18px] font-medium leading-[1.3] tracking-[-0.02em] text-[#1a1d29] transition-colors duration-150 hover:text-blue-600 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="mt-1 shrink-0 text-gray-400 transition-transform duration-300 group-open:rotate-45"
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
                <p className="mt-3 max-w-[620px] text-[15px] leading-[1.6] text-gray-500">
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
    <section className="px-2 pb-2">
      <div className="relative isolate overflow-hidden rounded-[28px] text-center text-white" style={{ background: '#0a2a86' }}>
        <div aria-hidden className="mesh-drift absolute -inset-[8%] -z-10" style={{ background: MESH }} />
        <Reveal>
          <div className="mx-auto max-w-[820px] px-6 py-24 md:py-36">
            <h2 className="font-[family-name:var(--font-serif)] text-[44px] font-normal leading-[0.98] tracking-[-0.03em] md:text-[80px]">
              Hear it handle your first call in under a minute.
            </h2>
            <p className="mx-auto mt-7 max-w-[500px] text-[16px] leading-[1.55] text-white/80">
              No install, no card, no sales call. Pick a template and listen to it run.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <LightButton href="/demo" size="lg">Try free demo</LightButton>
              <GlassButton href="/pricing" size="lg">See pricing</GlassButton>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const FOOTER_LINKS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: 'Product', links: [{ href: '/#templates', label: 'Templates' }, { href: '/#platform', label: 'Platform' }, { href: '/pricing', label: 'Pricing' }, { href: '/demo', label: 'Live demo' }, { href: '/partners', label: 'Partner program' }] },
  { title: 'Developers', links: [{ href: '/docs', label: 'API reference' }, { href: '/api/v1/openapi.json', label: 'OpenAPI file' }, { href: '/docs#mcp', label: 'MCP server' }] },
  { title: 'Company', links: [{ href: '/privacy', label: 'Privacy' }, { href: '/terms', label: 'Terms' }, { href: '/partners', label: 'Partners' }] },
  { title: 'Account', links: [{ href: '/auth/login', label: 'Sign in' }, { href: '/dashboard', label: 'Dashboard' }] },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-gray-200 py-14">
      <Container>
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
          <div>
            <Link href="/" className="text-[18px] font-semibold tracking-[-0.04em] text-[#00122e]">CallDeskTech</Link>
            <p className="mt-3 max-w-[280px] text-[14px] leading-[1.5] text-gray-500">Voice agents that answer, book, transfer and follow up on your phone calls.</p>
          </div>
          {FOOTER_LINKS.map((g) => (
            <nav key={g.title} aria-label={g.title}>
              <p className="text-[13px] font-medium text-[#00122e]">{g.title}</p>
              <ul className="mt-3 space-y-2">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-[14px] text-gray-500 transition-colors duration-150 hover:text-[#00122e]">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="mt-12 text-[13px] text-gray-400">© {new Date().getFullYear()} CallDeskTech</p>
      </Container>
    </footer>
  );
}
