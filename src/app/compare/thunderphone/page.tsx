import type { Metadata } from 'next';
import { Container, Section, PrimaryButton, SecondaryButton } from '@/components/landing/primitives';

export const metadata: Metadata = {
  title: 'CallDeskTech vs ThunderPhone | CallDeskTech',
  description: 'A live mystery-shopper benchmark against ThunderPhone: same caller, same goal, same judge. 3 calls, 3 wins.',
};

const ROUNDS = [
  { label: 'Calls won', us: '3', them: '0' },
  { label: 'Avg. turns to resolve', us: '5.7', them: '11' },
  { label: 'Slowest response', us: '4.2s', them: '5.1s' },
];

export default function ThunderPhoneComparePage() {
  return (
    <main>
      <Container className="pt-16 pb-14 md:pt-24">
        <h1 className="max-w-[760px] text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">
          Three calls. Three wins. Half the turns.
        </h1>
        <p className="mt-6 max-w-[580px] text-[17px] leading-[1.5] text-gray-500">
          We ran the same mystery-shopper call against our agent and ThunderPhone&rsquo;s Spark tier three times, judged blind, and counted what happened.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryButton href="/demo" size="lg">Try a free demo call</PrimaryButton>
          <SecondaryButton href="/compare/retell" size="lg">See the Retell comparison</SecondaryButton>
        </div>
      </Container>

      <Container className="pb-16">
        <div className="grid gap-4 sm:grid-cols-3">
          {ROUNDS.map((r) => (
            <div key={r.label} className="rounded-xl border border-gray-200 p-6">
              <p className="text-[13px] font-medium text-gray-400">{r.label}</p>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-[32px] font-normal tracking-[-0.03em] text-[#00122e]">{r.us}</span>
                <span className="text-[13px] text-gray-400">us</span>
                <span className="text-[15px] text-gray-300">/</span>
                <span className="text-[20px] font-normal tracking-[-0.03em] text-gray-400">{r.them}</span>
                <span className="text-[13px] text-gray-400">them</span>
              </div>
            </div>
          ))}
        </div>
      </Container>

      <Section size="secondary" className="pt-0 pb-16 md:pb-20">
        <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
          How we ran it.
        </h2>
        <p className="mt-5 max-w-[620px] text-[16px] leading-[1.6] text-gray-600">
          Same shopper persona, same goal, same script, placed against our POC engine (Deepgram, Claude Haiku, Kokoro) and ThunderPhone&rsquo;s Spark tier (GPT-4o-mini) &mdash; their entry pricing tier, not their higher Bolt or Storm tiers. A blind judge scored each transcript on turns to resolution and response latency. Our first pass came back 2&ndash;1 because of a bug in how we scripted the shopper; we fixed it and reran clean, which is the 3&ndash;0 result above.
        </p>
      </Section>

      <div className="border-t border-gray-100 bg-[#f8f8fb]">
        <Section size="secondary" className="py-16 md:py-20">
          <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
            Where they&rsquo;re actually ahead.
          </h2>
          <div className="mt-6 max-w-[620px] space-y-4">
            <p className="text-[16px] leading-[1.6] text-gray-600">
              ThunderPhone is genuinely simpler to set up &mdash; a single prompt, no flow builder required. If you want something running in two minutes and don&rsquo;t need branching logic, that&rsquo;s a real advantage.
            </p>
            <p className="text-[16px] leading-[1.6] text-gray-600">
              They also ship 47 languages out of the box. We only tested this benchmark in English, so we can&rsquo;t compare language quality head to head here &mdash; see our language coverage on the <a href="/compare/retell" className="underline underline-offset-4 hover:text-blue-600">Retell comparison</a> instead.
            </p>
            <p className="text-[15px] leading-[1.6] text-gray-500">
              ThunderPhone also advertises 99.4% accuracy on their Storm tier. That figure is measured on their own dataset, not an independent benchmark, and this test didn&rsquo;t isolate that specific claim &mdash; we&rsquo;re noting it so you can weigh it yourself, not disputing it.
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
