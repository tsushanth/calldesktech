import {
  Card,
  CardBody,
  CardTitle,
  Eyebrow,
  Section,
  SectionLead,
  SectionTitle,
} from './primitives';
import { Reveal } from './Reveal';
import { Icons, type IconName } from './icons';

/**
 * The mid-page content sections.
 *
 * Structure and rhythm follow the reference sweep (140px major / 80px
 * secondary padding, 3-up card grids, 20px card headings at -0.05em); all copy
 * is this product's own and describes only capabilities it actually ships.
 */

/** 40px tinted tile holding a monoline icon — the reference's card-icon treatment. */
function IconTile({ name }: { name: IconName }) {
  const Icon = Icons[name];
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
      <Icon className="h-5 w-5" />
    </span>
  );
}

// ---------------------------------------------------------------- capabilities

const CAPABILITIES = [
  {
    icon: 'bolt' as IconName,
    title: 'Sub-500ms latency',
    body: 'Semantic turn detection instead of dead-air silence timers. No awkward robot pauses mid-sentence.',
  },
  {
    icon: 'calendar' as IconName,
    title: 'Calendar integration',
    body: 'Sync with Google, Outlook, and iCal via Cal.com. Availability is read live, not cached.',
  },
  {
    icon: 'book' as IconName,
    title: 'Knowledge base',
    body: 'Upload your FAQ or point it at your website. The agent answers from your material, not guesswork.',
  },
  {
    icon: 'blocks' as IconName,
    title: 'Independent blocks',
    body: 'Booking, transfer, and message-taking are separate toggles. Turn any of them on or off without a rebuild.',
  },
  {
    icon: 'chart' as IconName,
    title: 'Call analytics',
    body: 'Call volume, booking rate, and the questions callers actually ask — with full transcripts.',
  },
  {
    icon: 'phone' as IconName,
    title: 'Phone numbers',
    body: 'Take a dedicated number or forward the one you already publish. Works internationally.',
  },
];

export function Capabilities() {
  return (
    <Section id="capabilities">
      <Reveal>
        <div className="max-w-[640px]">
          <Eyebrow>Capabilities</Eyebrow>
          <SectionTitle className="mt-6">
            Everything you need to automate your phone.
          </SectionTitle>
          <SectionLead>
            Turn on only what your business needs. Every capability below is a
            real, testable building block — not a marketing bullet point.
          </SectionLead>
        </div>
      </Reveal>

      <div className="mt-14 grid gap-4 md:mt-16 md:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((c, i) => (
          <Reveal key={c.title} delay={(i % 3) * 60}>
            <Card className="h-full">
              <IconTile name={c.icon} />
              <div className="mt-5">
                <CardTitle>{c.title}</CardTitle>
                <CardBody>{c.body}</CardBody>
              </div>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

// -------------------------------------------------------------- building blocks

const BLOCKS = [
  {
    tag: 'FAQ',
    title: 'Answer questions',
    body: 'Hours, location, pricing, parking, what you do and do not offer. Sourced from your own material so the answers stay accurate.',
  },
  {
    tag: 'Booking',
    title: 'Book appointments',
    body: 'Reads live calendar availability, offers real slots, and writes the booking back — inside a single call.',
  },
  {
    tag: 'Transfer',
    title: 'Transfer the call',
    body: 'Route to the right person or team when the caller needs a human, with the context of what they already said.',
  },
  {
    tag: 'Messages',
    title: 'Take a message',
    body: 'Capture name, number, and reason for calling, then deliver a clean summary rather than a raw voicemail.',
  },
];

export function BuildingBlocks() {
  return (
    <Section id="building-blocks" size="secondary">
      <Reveal>
        <div className="max-w-[640px]">
          <Eyebrow>Building blocks</Eyebrow>
          <SectionTitle className="mt-6">
            Four blocks. Pick the ones you need.
          </SectionTitle>
          <SectionLead>
            Most phone AI ships as one opaque bundle you either accept or fight.
            This is assembled from parts you can switch on individually and hear
            working on their own.
          </SectionLead>
        </div>
      </Reveal>

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        {BLOCKS.map((b, i) => (
          <Reveal key={b.tag} delay={(i % 2) * 60}>
            <Card className="h-full">
              <span className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-blue-600">
                {b.tag}
              </span>
              <div className="mt-5">
                <CardTitle>{b.title}</CardTitle>
                <CardBody>{b.body}</CardBody>
              </div>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

// --------------------------------------------------------------- how it works

const STEPS = [
  {
    n: '01',
    title: 'Try a capability',
    body: 'Hear exactly one thing it does — FAQs, booking, transfer, or messages.',
  },
  {
    n: '02',
    title: 'Pick your blocks',
    body: 'Choose the ones your business actually needs. Nothing else gets enabled.',
  },
  {
    n: '03',
    title: 'Add your info',
    body: 'Business hours, services, and calendar. Takes a couple of minutes.',
  },
  {
    n: '04',
    title: 'Go live',
    body: 'Get your phone number and start taking real calls the same day.',
  },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works" size="secondary">
      <Reveal>
        <div className="max-w-[640px]">
          <Eyebrow>How it works</Eyebrow>
          <SectionTitle className="mt-6">
            Live today, not next quarter.
          </SectionTitle>
        </div>
      </Reveal>

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 60}>
            <Card className="h-full">
              <span className="text-[13px] font-medium tabular-nums tracking-[0.08em] text-blue-600">
                {s.n}
              </span>
              <div className="mt-5">
                <CardTitle>{s.title}</CardTitle>
                <CardBody>{s.body}</CardBody>
              </div>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
