import type { Metadata } from 'next';
import { Container, Section, PrimaryButton, SecondaryButton } from '@/components/landing/primitives';

export const metadata: Metadata = {
  title: 'CallDeskTech vs building your own | CallDeskTech',
  description: 'What it actually takes to roll your own phone agent on LiveKit Agents or Pipecat, versus buying a finished product.',
};

const BUILD_ITEMS = [
  { item: 'Pick and wire up an LLM, STT, and TTS provider', us: 'Already chosen and integrated (Kokoro, ElevenLabs, Cartesia, MiniMax)', diy: 'Your call — and your ongoing bill across three separate vendors' },
  { item: 'Write the agent’s conversation logic', us: 'A node-based flow builder: 17 node types ready to assemble', diy: 'You write and maintain it in code against the framework’s APIs' },
  { item: 'Telephony (numbers, call routing)', us: 'Forward a number you own or buy one from us (no SIP trunking; a Twilio port-in request form exists, ask us first)', diy: 'You configure SIP trunking yourself through a carrier (Twilio, Telnyx, Plivo, and others all work with these frameworks)' },
  { item: 'Hosting & scaling the agent process', us: 'Included', diy: 'Managed hosting is available (LiveKit Cloud, Pipecat Cloud) starting around $0.01–$0.03/min compute, or you self-host it' },
  { item: 'Call monitoring & transcripts', us: 'Built into the dashboard', diy: 'Available on managed hosting (30-day retention typical) or you build your own logging' },
  { item: 'Ongoing maintenance as providers change', us: 'Our job', diy: 'Yours — provider SDKs, pricing, and model versions all shift over time' },
];

export default function BuildYourOwnComparePage() {
  return (
    <main>
      <Container className="pt-16 pb-14 md:pt-24">
        <h1 className="max-w-[760px] text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">
          You can build this yourself. Here&rsquo;s what that costs.
        </h1>
        <p className="mt-6 max-w-[580px] text-[17px] leading-[1.5] text-gray-500">
          Open-source frameworks like LiveKit Agents and Pipecat are real, capable, and free to start. They also hand you six jobs we’ve already done. Here’s the honest list.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryButton href="/demo" size="lg">Try a free demo call</PrimaryButton>
          <SecondaryButton href="/compare" size="lg">See all comparisons</SecondaryButton>
        </div>
      </Container>

      <Section size="secondary" className="pt-0 pb-16 md:pb-20">
        <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
          What you still have to build.
        </h2>
        <p className="mt-4 max-w-[560px] text-[15px] leading-[1.5] text-gray-500">
          Based on the public documentation for LiveKit Agents and Pipecat, the two most common open-source starting points, plus their managed hosting options (LiveKit Cloud, Pipecat Cloud).
        </p>

        <div className="mt-10 divide-y divide-gray-100 border-t border-gray-100">
          {BUILD_ITEMS.map((row) => (
            <div key={row.item} className="grid gap-2 py-5 sm:grid-cols-[240px_1fr_1fr] sm:items-start sm:gap-6">
              <p className="text-[14.5px] font-medium text-[#1a1d29]">{row.item}</p>
              <p className="text-[14px] leading-[1.5] text-gray-700">
                <span className="text-gray-400">Us: </span>{row.us}
              </p>
              <p className="text-[14px] leading-[1.5] text-gray-500">
                <span className="text-gray-400">Building it yourself: </span>{row.diy}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-10 max-w-[640px] text-[12.5px] leading-[1.5] text-gray-400">
          This isn&rsquo;t a case against building your own — if you have the engineering time and want full control over every provider in the stack, both frameworks are genuinely good and open-source. It&rsquo;s a honest accounting of what &ldquo;free&rdquo; actually includes.
        </p>
      </Section>

      <div className="border-t border-gray-100 bg-[#f8f8fb]">
        <Section size="secondary" className="py-16 md:py-20">
          <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
            When building your own makes sense.
          </h2>
          <div className="mt-6 max-w-[620px] space-y-4">
            <p className="text-[16px] leading-[1.6] text-gray-600">
              If you need a provider combination we don&rsquo;t support, want to self-host for data-residency reasons, or already have a team maintaining real-time voice infrastructure, building on LiveKit Agents or Pipecat directly is a legitimate choice — that’s what those frameworks are for.
            </p>
            <p className="text-[16px] leading-[1.6] text-gray-600">
              If you want a phone agent live this week without owning the STT/LLM/TTS/telephony stack yourself, that’s the six jobs above we&rsquo;ve already done.
            </p>
          </div>
        </Section>
      </div>

      <Container className="py-20 md:py-24 text-center">
        <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
          Hear it yourself.
        </h2>
        <p className="mx-auto mt-4 max-w-[480px] text-[16px] leading-[1.5] text-gray-500">
          Place a real call to one of our demo agents. No account required.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <PrimaryButton href="/demo" size="lg">Try a free demo call</PrimaryButton>
          <SecondaryButton href="/compare" size="lg">See all comparisons</SecondaryButton>
        </div>
      </Container>
    </main>
  );
}
