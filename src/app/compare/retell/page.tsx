import type { Metadata } from 'next';
import { Container, Section, PrimaryButton, SecondaryButton } from '@/components/landing/primitives';
import { HEADLINE_WITH_QUALIFIER, LIVE_RANGE, CARRIER_SHORT } from '@/lib/pricingCopy';

export const metadata: Metadata = {
  title: 'CallDeskTech vs Retell | CallDeskTech',
  description: 'A feature-by-feature comparison with Retell: the builder, pricing, and what live test calls actually showed.',
};

type Verdict = 'Ahead' | 'Have' | 'Partial' | 'Gap' | 'Neither';

const VERDICT_STYLE: Record<Verdict, string> = {
  Ahead: 'bg-blue-50 text-blue-700',
  Have: 'bg-[#f0f0f8] text-[#00122e]',
  Partial: 'bg-amber-50 text-amber-700',
  Gap: 'bg-gray-100 text-gray-500',
  Neither: 'bg-gray-100 text-gray-400',
};

const ROWS: { group: string; item: string; verdict: Verdict; note: string }[] = [
  { group: 'Building the agent', item: 'Flow node types', verdict: 'Ahead', note: '17 node types (extraction, KB lookup, agent handoff, payment, MCP call, subflows) vs Retell’s six.' },
  { group: 'Building the agent', item: 'Version history & environments', verdict: 'Have', note: 'Staging and production, instant re-routing on promote.' },
  { group: 'Building the agent', item: 'Test call in browser', verdict: 'Have', note: 'In-browser mic call, same idea as Retell’s shareable voice link.' },
  { group: 'Voice & language', item: 'Languages, real-call-verified', verdict: 'Partial', note: '49 of Retell’s 55, but ahead on 5 they don’t have at all (Bengali, Gujarati, Punjabi, Georgian, Telugu). The remaining 6 are blocked upstream, on speech recognition, not our text-to-speech.' },
  { group: 'Voice & language', item: 'Voice providers', verdict: 'Have', note: 'Kokoro, ElevenLabs, Cartesia, MiniMax vs ElevenLabs and PlayHT.' },
  { group: 'Telephony', item: 'In-call SMS', verdict: 'Ahead', note: 'A flow node, no extra charge. Retell sells this as a $20/mo add-on.' },
  { group: 'Telephony', item: 'Voicemail detection, batch calling', verdict: 'Have', note: 'Both platforms support this; we haven’t independently confirmed Retell’s exact limits.' },
  { group: 'Tools & data', item: 'Payment collection', verdict: 'Ahead', note: 'We couldn’t find this on Retell’s side at all.' },
  { group: 'Tools & data', item: 'MCP server authentication', verdict: 'Ahead', note: 'Real OAuth 2.1 login for external MCP clients. Retell’s is unconfirmed beyond existing.' },
  { group: 'Tools & data', item: 'Knowledge base, custom functions, calendar booking', verdict: 'Have', note: 'Comparable depth on both sides.' },
  { group: 'After the call', item: 'Customizable dashboards', verdict: 'Gap', note: 'Retell shipped user-configurable dashboards; ours aren’t configurable yet.' },
  { group: 'Pricing', item: 'Price per minute', verdict: 'Have', note: `${HEADLINE_WITH_QUALIFIER} Retell lists $0.07 to $0.31 per minute depending on configuration, and its own pricing-page example comes to about $0.11 per minute. The ranges overlap, so this is a comparison of structure rather than a win either way: our tiers bundle the language model and voice into one per-minute rate, and Pro adds phone numbers.` },
  { group: 'Pricing', item: 'Free tier', verdict: 'Gap', note: 'Retell gives new accounts $10 in credit and 20 free concurrent calls. We don’t have a free tier yet.' },
  { group: 'Team & access', item: 'White-labeling', verdict: 'Neither', note: 'Confirmed absent on both sides.' },
];

const GROUPS = Array.from(new Set(ROWS.map((r) => r.group)));

export default function RetellComparePage() {
  return (
    <main>
      <Container className="pt-16 pb-14 md:pt-24">
        <h1 className="max-w-[760px] text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">
          Retell charges by the piece. We charge by the minute.
        </h1>
        <p className="mt-6 max-w-[580px] text-[17px] leading-[1.5] text-gray-500">
          We read Retell’s docs, pricing pages, and changelog, then checked what we could against our own live account and real test calls. Here’s what we found, gaps included.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryButton href="/demo" size="lg">Try a free demo call</PrimaryButton>
          <SecondaryButton href="/pricing" size="lg">See pricing</SecondaryButton>
        </div>
      </Container>

      <Container className="pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-6">
            <p className="text-[13px] font-medium text-gray-400">Our price, available now (Standard to Pro)</p>
            <p className="mt-2 text-[32px] font-normal tracking-[-0.03em] text-[#00122e]">{LIVE_RANGE}<span className="text-[15px] text-gray-400">/min</span></p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6">
            <p className="text-[13px] font-medium text-gray-400">Phone service</p>
            <p className="mt-2 text-[20px] font-normal leading-[1.3] tracking-[-0.03em] text-[#00122e]">Included on Pro; {CARRIER_SHORT.replace(' on Lite and Standard', '')} on Lite and Standard</p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6">
            <p className="text-[13px] font-medium text-gray-400">Retell, published list price</p>
            <p className="mt-2 text-[32px] font-normal tracking-[-0.03em] text-gray-700">$0.07–$0.31<span className="text-[15px] text-gray-400">/min</span></p>
            <p className="mt-1 text-[13px] text-gray-500">Retell’s own pricing-page example: about $0.11/min</p>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] leading-[1.5] text-gray-400">
          {HEADLINE_WITH_QUALIFIER} Our optional add-ons are coming soon and cannot be bought yet. Retell figures are Retell’s published list prices from retellai.com/pricing, retrieved October 1, 2026: “$0.07-$0.31 / min for AI Voice Agents”, and a worked example on the same page that comes to $0.11 per minute (LLM $0.04, voice infrastructure $0.055, text-to-speech $0.015, no telephony or add-ons). Configurations vary, so your own total will depend on the choices you make.
        </p>
      </Container>

      <Section size="secondary" className="pt-0 pb-16 md:pb-20">
        <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
          Feature by feature.
        </h2>
        <p className="mt-4 max-w-[560px] text-[15px] leading-[1.5] text-gray-500">
          Grouped by where the work actually happens. Where Retell is ahead of us, we’ve said so.
        </p>

        <div className="mt-10 space-y-10">
          {GROUPS.map((group) => (
            <div key={group}>
              <h3 className="text-[15px] font-semibold text-[#1a1d29]">{group}</h3>
              <div className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
                {ROWS.filter((r) => r.group === group).map((r) => (
                  <div key={r.item} className="grid gap-2 py-4 sm:grid-cols-[220px_90px_1fr] sm:items-start sm:gap-6">
                    <p className="text-[14.5px] font-medium text-[#1a1d29]">{r.item}</p>
                    <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${VERDICT_STYLE[r.verdict]}`}>
                      {r.verdict}
                    </span>
                    <p className="text-[14px] leading-[1.5] text-gray-500">{r.note}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-[12.5px] leading-[1.5] text-gray-400 max-w-[640px]">
          Our side of this table is grounded in our own codebase and, where noted, real calls. Retell’s side comes from their public docs, pricing pages, and changelog — not a hands-on account audit — so treat it as directional rather than certain, and tell us if something’s changed on their end.
        </p>
      </Section>

      <div className="border-t border-gray-100 bg-[#f8f8fb]">
        <Section size="secondary" className="py-16 md:py-20">
          <h2 className="text-[32px] md:text-[44px] font-normal leading-[1.04] tracking-[-0.045em] text-[#00122e]">
            How we test it.
          </h2>
          <p className="mt-5 max-w-[620px] text-[16px] leading-[1.6] text-gray-600">
            We place live calls against both agents with the same caller persona and the same goal, then have an independent judge score fluency and whether the goal was actually met.
          </p>
          <p className="mt-4 max-w-[620px] text-[16px] leading-[1.6] text-gray-600">
            The first Spanish run we placed surfaced a real gap: our receptionist template didn’t have pricing content seeded, so it transferred the caller with nothing resolved. Retell’s agent didn’t know the price either, but it offered a concrete appointment slot instead of a dead end. We shipped a fix the same day — a seeded knowledge-base node and a prompt that pivots to booking instead of transferring — and re-verified in English: the agent now collects a callback number and closes with a resolved next step.
          </p>
          <p className="mt-4 max-w-[620px] text-[15px] leading-[1.6] text-gray-500">
            We haven’t re-run the Spanish comparison against Retell since the fix, so we’re not claiming a rematch win here — just showing what happens when a test call finds something wrong.
          </p>
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
          <SecondaryButton href="/compare/thunderphone" size="lg">See the ThunderPhone comparison</SecondaryButton>
        </div>
      </Container>
    </main>
  );
}
