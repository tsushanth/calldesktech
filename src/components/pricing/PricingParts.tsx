import { ADD_ONS, INCLUDED_ON_ALL, ratingsForStack, type PricingTier } from '@/lib/pricingTiers';
import { EXPERT_BACKUP, expertBackupAllowedTierNames, expertBackupPriceShort } from '@/lib/expertBackup';
import { ADD_ONS_LINE, BRING_YOUR_OWN_LINE, HIGH_VOLUME, PHONE_NUMBER_OPTIONS, workedExample } from '@/lib/pricingCopy';

// Shared, server-renderable pieces of the tier structure (pricing page, docs page, home summary): the three rating rows per tier, the one
// "Included on every plan" block, and the Extras section. All text comes from src/lib/pricingTiers.ts and src/lib/pricingCopy.ts.

/** Voice / Response speed / Reasoning, as short text labels derived from the tier's stack. */
export function TierRatingRows({ tier, className = '' }: { tier: PricingTier; className?: string }) {
  const r = ratingsForStack(tier.stack);
  const rows: Array<[string, string]> = [['Voice', r.voice], ['Response speed', r.responseSpeed], ['Reasoning', r.reasoning]];
  return (
    <dl className={`divide-y divide-gray-100 border-y border-gray-100 text-[13.5px] ${className}`} data-testid={`tier-ratings-${tier.id}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-gray-500">{k}</dt>
          <dd className="font-medium text-[#00122e]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The platform features every plan has, stated once. */
export function IncludedOnEveryPlan() {
  return (
    <section aria-labelledby="included-heading" className="mx-auto mt-12 max-w-3xl" data-testid="included-on-every-plan">
      <h2 id="included-heading" className="text-[24px] font-semibold tracking-[-0.02em] text-[#00122e]">Included on every plan</h2>
      <p className="mt-2 text-[14px] leading-[1.5] text-gray-500">The plans differ only in the engine: voice, response speed and reasoning. Everything below is the same on all three.</p>
      <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {INCLUDED_ON_ALL.map((item) => (
          <li key={item} className="flex items-start gap-3 text-[14px] leading-[1.45] text-gray-700">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Extras: phone numbers (live, priced), the add-ons that are still coming soon (no amounts), and the worked example. */
export function ExtrasSection() {
  return (
    <section aria-labelledby="extras-heading" className="mx-auto mt-12 max-w-3xl" data-testid="pricing-extras">
      <h2 id="extras-heading" className="text-[24px] font-semibold tracking-[-0.02em] text-[#00122e]">Extras</h2>
      <p className="mt-2 text-[14px] leading-[1.5] text-gray-500">Everything beyond the engine is a priced extra, never a reason to pick a plan.</p>

      <div className="mt-4 rounded-xl border border-gray-200 p-4" data-testid="extras-phone-numbers">
        <p className="text-[15px] font-medium text-[#00122e]">Phone numbers</p>
        <p className="mt-0.5 text-[13px] leading-[1.45] text-gray-500">Available on every plan. Add a number from us, or bring your own.</p>
        <ul className="mt-3 divide-y divide-gray-100">
          {PHONE_NUMBER_OPTIONS.map((o) => (
            <li key={o.carrier} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="text-[14px] text-[#00122e]">{o.name}</p>
                <p className="text-[12.5px] text-gray-500">{o.note}</p>
              </div>
              <p className="flex-none text-[14px] text-[#00122e]">{o.monthly} + {o.inbound}</p>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-6 py-2">
            <p className="text-[14px] text-[#00122e]">{BRING_YOUR_OWN_LINE.split(':')[0]}</p>
            <p className="flex-none text-[14px] text-[#00122e]">Free</p>
          </li>
        </ul>
        <p className="mt-3 text-[13px] leading-[1.5] text-gray-600" data-testid="worked-example">{workedExample().text}</p>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 p-4" data-testid="extras-expert-backup">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-[#00122e]">{EXPERT_BACKUP.label}<span className="ml-2 text-[12px] font-normal text-gray-400">off by default</span></p>
            <p className="mt-0.5 text-[13px] leading-[1.45] text-gray-500">{EXPERT_BACKUP.description} Available on {expertBackupAllowedTierNames()}.</p>
          </div>
          <p className="flex-none text-[14px] text-[#00122e]">{expertBackupPriceShort()}</p>
        </div>
      </div>

      <h3 className="mt-6 text-[15px] font-semibold text-[#00122e]">Optional add-ons, coming soon</h3>
      <p className="mt-1 text-[13px] leading-[1.5] text-gray-500">{ADD_ONS_LINE}</p>
      <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {ADD_ONS.map((a) => (
          <li key={a.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-[#00122e]">{a.label}{!a.defaultOn && <span className="ml-2 text-[12px] font-normal text-gray-400">off by default</span>}</p>
              <p className="mt-0.5 text-[13px] leading-[1.45] text-gray-500">{a.description}</p>
            </div>
            <p className="flex-none text-[13px] text-gray-500">Coming soon</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** High-volume dedicated models: a "talk to us" block, not a buyable plan (see HIGH_VOLUME in pricingCopy.ts for the copy rules). */
export function HighVolumeSection() {
  return (
    <section aria-labelledby="high-volume-heading" className="mx-auto mt-12 max-w-3xl rounded-2xl border border-[#e4e4f0] bg-gray-50 p-6" data-testid="pricing-high-volume">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="high-volume-heading" className="text-[24px] font-semibold tracking-[-0.02em] text-[#00122e]">{HIGH_VOLUME.heading}</h2>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-700">{HIGH_VOLUME.status}</span>
      </div>
      <p className="mt-3 text-[15px] leading-[1.55] text-gray-700">{HIGH_VOLUME.intro}</p>
      <ul className="mt-4 space-y-3">
        {HIGH_VOLUME.points.map((pt) => (
          <li key={pt.title}>
            <p className="text-[15px] font-medium text-[#00122e]">{pt.title}</p>
            <p className="mt-0.5 text-[13px] leading-[1.5] text-gray-600">{pt.body}</p>
          </li>
        ))}
      </ul>
      <a href={HIGH_VOLUME.ctaHref} className="mt-5 inline-block text-[#00122e] font-medium underline underline-offset-4 hover:text-blue-600">{HIGH_VOLUME.cta}</a>
    </section>
  );
}
