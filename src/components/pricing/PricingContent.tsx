import type { ReactNode } from 'react';
import Link from 'next/link';
import { PRICING_TIERS, ADD_ONS, CARRIER_NOTE } from '@/lib/pricingTiers';
import { LITE_CENTS, centsLabel } from '@/lib/pricingCopy';
import { PricingCalculator } from '@/components/pricing/PricingCalculator';

// Server-rendered body of /pricing. `cta` is the checkout button (a client island, see GetStartedButton) so everything else is plain HTML.
export function PricingContent({ cta }: { cta: ReactNode }) {
  return (
    <main className="bg-white py-14 px-4 md:py-20">
      <div className="max-w-5xl mx-auto">
        {/* Header: the claim, the plain-language terms, and a calculator so a visitor can price their own month */}
        <div className="mb-12 grid items-start gap-8 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <div className="min-w-0">
            <h1 className="text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[60px]">
              {`Phone agents from ${centsLabel(LITE_CENTS)} a minute.`}
            </h1>
            <p className="mt-5 max-w-[34rem] text-[17px] leading-[1.5] text-gray-600">
              Lite at 2¢ is coming soon. Standard at 6¢ and Pro at 10¢ are available now. You pay for talk time only, with no monthly minimum and no per-booking or per-transfer fees.
            </p>
            <p className="mt-4 max-w-[34rem] text-[15px] leading-[1.55] text-gray-500">
              The plans are priced the way other per-minute voice platforms such as ThunderPhone price theirs: a rate for the agent, with your phone carrier billed separately unless it is included.{' '}
              <Link href="/compare/thunderphone" className="text-[#00122e] underline underline-offset-4 hover:text-blue-600">See the comparison</Link>.
            </p>
          </div>
          <PricingCalculator />
        </div>

        {/* Tiers */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3" data-testid="pricing-tiers">
          {PRICING_TIERS.map((t) => {
            const soon = t.availability === 'coming_soon';
            return (
              <section
                key={t.id}
                aria-labelledby={`plan-${t.id}`}
                className={`flex min-w-0 flex-col rounded-2xl border p-7 ${soon ? 'border-gray-200 bg-gray-50' : t.id === 'standard' ? 'border-[#00122e] bg-white' : 'border-[#e4e4f0] bg-white'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 id={`plan-${t.id}`} className="text-2xl font-semibold tracking-[-0.03em] text-[#00122e]">{t.name}</h2>
                  {soon && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-700">Coming soon</span>}
                </div>
                <p className="mt-4 text-[#00122e]">
                  <span className="text-5xl font-normal tracking-[-0.05em]">${(t.pricePerMinuteCents / 100).toFixed(2)}</span>
                  <span className="text-gray-500"> per minute</span>
                </p>
                <p className="mt-1 text-[13px] text-gray-500">{t.carrierMode === 'byo' ? 'Phone carrier billed separately*' : 'Phone numbers and calling included'}</p>
                <p className="mt-4 text-[15px] leading-[1.5] text-gray-700">{t.tagline}</p>
                <p className="mt-2 text-[13px] leading-[1.5] text-gray-500">{t.whoItsFor}</p>
                <ul className="mt-5 space-y-3">
                  {t.includes.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[14px] leading-[1.45] text-gray-700">
                      <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                {soon && <p className="mt-auto pt-5 text-[13px] font-medium text-gray-500">Not available to start yet.</p>}
              </section>
            );
          })}
        </div>

        <p className="mx-auto mt-5 max-w-3xl text-center text-[13px] leading-[1.5] text-gray-500">*{CARRIER_NOTE}</p>

        {/* Add-ons */}
        <section aria-labelledby="addons-heading" className="mx-auto mt-14 max-w-3xl">
          <h2 id="addons-heading" className="text-[24px] font-semibold tracking-[-0.02em] text-[#00122e]">Optional add-ons</h2>
          <p className="mt-2 text-[14px] leading-[1.5] text-gray-500">Included on every plan: call summary, transcript and structured field extraction. These are extra and always your choice.</p>
          <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {ADD_ONS.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-[#00122e]">{a.label}{!a.defaultOn && <span className="ml-2 text-[12px] font-normal text-gray-400">off by default</span>}</p>
                  <p className="mt-0.5 text-[13px] leading-[1.45] text-gray-500">{a.description}</p>
                </div>
                <p className="flex-none text-[13px] text-gray-500">{a.centsPerMinute === null ? 'Price to be announced' : `+$${(a.centsPerMinute / 100).toFixed(3)} per minute`}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Get started: unchanged checkout */}
        <div className="mt-12 flex flex-col items-center gap-3">
          {cta}
          <p className="max-w-xl text-center text-[13px] text-gray-400">
            No monthly minimum. Cancel anytime. Already a customer? Your current per-minute price does not change.
          </p>
        </div>

        {/* Try Demo Link */}
        <div className="text-center mt-12">
          <p className="text-gray-500 mb-2">Want to try before you buy?</p>
          <Link
            href="/demo"
            className="text-[#00122e] font-medium underline underline-offset-4 hover:text-blue-600"
          >
            Try a free demo call
          </Link>
        </div>

      </div>
    </main>
  );
}
