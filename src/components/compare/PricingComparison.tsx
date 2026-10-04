import { PRICING_TIERS } from '@/lib/pricingTiers';
import { ADD_ONS_LINE, HEADLINE_WITH_QUALIFIER, centsLabel } from '@/lib/pricingCopy';
import type { CompetitorPricing } from '@/lib/competitorPricing';

// Side-by-side published pricing: ours from src/lib/pricingTiers.ts, the competitor's from src/lib/competitorPricing.ts.
// Both are data-driven; there is no hand-written price in this component.

function ourIncluded(t: (typeof PRICING_TIERS)[number]): string {
  return t.carrierMode === 'managed' ? 'AI engine plus phone numbers and calling' : 'AI engine';
}
function ourSeparate(t: (typeof PRICING_TIERS)[number]): string {
  return t.carrierMode === 'managed' ? 'Nothing else today' : 'Your phone carrier (bring your own), or phone numbers from us as an extra';
}

export function PricingComparison({ competitor }: { competitor: CompetitorPricing }) {
  const cell = 'px-4 py-3 align-top text-[14px] leading-[1.45] text-gray-600';
  const head = 'px-4 py-3 text-left text-[12px] font-medium uppercase tracking-[0.1em] text-gray-400';
  return (
    <div data-testid="pricing-comparison">
      <p className="mt-5 max-w-[620px] text-[16px] leading-[1.6] text-gray-600">
        The two price lists have a similar structure: a per-minute rate for the AI engine in three tiers, with optional add-ons planned for later. {HEADLINE_WITH_QUALIFIER}
      </p>
      <div className="mt-8 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="border-b border-gray-200">
            <tr>
              <th className={head}>Vendor</th>
              <th className={head}>Tier</th>
              <th className={head}>Per minute</th>
              <th className={head}>Included</th>
              <th className={head}>Billed separately</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {PRICING_TIERS.map((t) => (
              <tr key={`us-${t.id}`}>
                <td className={`${cell} font-medium text-[#1a1d29]`}>CallDeskTech</td>
                <td className={cell}>
                  {t.name}
                  {t.availability === 'coming_soon' ? ' (coming soon)' : ''}
                </td>
                <td className={`${cell} text-[#1a1d29]`}>{centsLabel(t.pricePerMinuteCents)}</td>
                <td className={cell}>{ourIncluded(t)}</td>
                <td className={cell}>{ourSeparate(t)}</td>
              </tr>
            ))}
            {competitor.tiers.map((t) => (
              <tr key={`them-${t.name}`}>
                <td className={`${cell} font-medium text-[#1a1d29]`}>{competitor.vendor}</td>
                <td className={cell}>{t.name}</td>
                <td className={`${cell} text-[#1a1d29]`}>{centsLabel(t.centsPerMinute)}</td>
                <td className={cell}>{t.included}</td>
                <td className={cell}>{t.billedSeparately}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 max-w-[680px] list-disc space-y-1 pl-5 text-[13.5px] leading-[1.5] text-gray-500">
        {competitor.otherLineItems.map((l) => (
          <li key={l}>
            {competitor.vendor}: {l}
          </li>
        ))}
        <li>CallDeskTech: transfers, DTMF, testing and monitoring are included in the per-minute rate, with no per-booking or per-transfer fees on the tiers. Phone numbers from us are a paid extra on every plan; bringing your own is free.</li>
        <li>{ADD_ONS_LINE} <a href="/pricing" className="underline underline-offset-4 hover:text-blue-600">See the pricing page</a>.</li>
      </ul>
      <p className="mt-4 text-[12.5px] leading-[1.5] text-gray-400" data-testid="pricing-source">
        {competitor.vendor} prices are their published list prices, retrieved {competitor.retrievedAt} from{' '}
        <a href={competitor.source} className="underline underline-offset-4 hover:text-blue-600" rel="noopener noreferrer">{competitor.source}</a>. Prices change; check their page for the current numbers.
      </p>
    </div>
  );
}
