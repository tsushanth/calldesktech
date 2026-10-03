import { Eyebrow, PrimaryButton, SecondaryButton, Section, SectionTitle } from './primitives';
import { Reveal } from './Reveal';
import { PRICING_TIERS } from '@/lib/pricingTiers';
import { ADD_ONS_LINE, HEADLINE, QUALIFIER, centsLabel } from '@/lib/pricingCopy';

// Home-page pricing summary. Every number comes from src/lib/pricingTiers.ts (via pricingCopy.ts); the full detail lives on /pricing.
// The headline price is never shown without the "coming soon" qualifier.
export function PricingSummary() {
  return (
    <Section id="pricing-summary" size="secondary">
      <Reveal>
        <div className="max-w-[640px]">
          <Eyebrow>Pricing</Eyebrow>
          <SectionTitle className="mt-6">{HEADLINE}.</SectionTitle>
          <p className="mt-5 max-w-[540px] text-[16px] leading-[1.5] text-gray-500">{QUALIFIER}.</p>
        </div>
      </Reveal>
      <Reveal delay={80}>
        <div className="mt-10 grid gap-4 md:grid-cols-3" data-testid="pricing-summary-tiers">
          {PRICING_TIERS.map((t) => (
            <div key={t.id} className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#1a1d29]">{t.name}</h3>
                {t.availability === 'coming_soon' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">Coming soon</span>}
              </div>
              <p className="mt-2 text-[30px] font-normal tracking-[-0.04em] text-[#00122e]">
                {centsLabel(t.pricePerMinuteCents)}
                <span className="text-[14px] text-gray-400"> / min</span>
              </p>
              <p className="mt-2 text-[14px] leading-[1.45] text-gray-500">{t.tagline}</p>
              <p className="mt-3 text-[12.5px] text-gray-400">{t.carrierMode === 'byo' ? 'Bring your own phone carrier, billed separately' : 'Phone numbers and calling included'}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 max-w-[680px] text-[13.5px] leading-[1.5] text-gray-500">
          Transfers, DTMF, testing and monitoring are included in the per-minute rate, with no per-booking or per-transfer fees. Managed phone numbers are available for Lite and Standard. {ADD_ONS_LINE}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <PrimaryButton href="/pricing" size="lg">See full pricing</PrimaryButton>
          <SecondaryButton href="/demo" size="lg">Try a free demo call</SecondaryButton>
        </div>
      </Reveal>
    </Section>
  );
}
