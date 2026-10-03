'use client';

import type { ReactNode } from 'react';
import { PRICING_TIERS, CARRIER_NOTE, type TierId } from '@/lib/pricingTiers';

// Three-card pricing tier picker for the agent version publish panel. The tier is the product: no model names or token talk here.
// The existing model controls go in `advanced`, collapsed by default. Cards stack in one column so it fits the 400px settings
// panel and a 390px phone screen without horizontal scrolling. Native radio inputs inside labels give keyboard (arrow keys) and
// screen reader support; a tier that is not on sale yet is a disabled radio with a visible "Coming soon" badge.
export default function TierPicker({
  value,
  onChange,
  advanced,
  lowerQualityAccepted = false,
  onLowerQualityAcceptedChange,
}: {
  value: TierId | '';
  onChange: (tier: TierId | '') => void;
  advanced?: ReactNode;
  /** Whether the customer has accepted the voice-quality tradeoff of a lowerQuality tier (the cheapest voice). */
  lowerQualityAccepted?: boolean;
  onLowerQualityAcceptedChange?: (accepted: boolean) => void;
}) {
  const selectedTier = PRICING_TIERS.find((t) => t.id === value);
  const showCarrierNote = PRICING_TIERS.some((t) => t.carrierMode === 'byo');
  return (
    <div className="space-y-2" data-testid="tier-picker">
      <div>
        <p className="text-[12.5px] font-medium text-gray-500" id="tier-picker-label">Plan</p>
        <p className="mt-0.5 text-[11.5px] leading-[1.45] text-gray-400">Pick how this agent is priced. We choose the voice and intelligence for you.</p>
      </div>
      <div role="radiogroup" aria-labelledby="tier-picker-label" aria-describedby="tier-picker-note" className="grid grid-cols-1 gap-2">
        {PRICING_TIERS.map((t) => {
          const disabled = t.availability !== 'live';
          const selected = value === t.id;
          return (
            <label
              key={t.id}
              className={`relative block min-w-0 rounded-xl border p-3 transition ${
                disabled
                  ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-70'
                  : selected
                    ? 'cursor-pointer border-blue-500 bg-blue-50/50 ring-2 ring-blue-100'
                    : 'cursor-pointer border-gray-200 bg-white hover:border-gray-300'
              } focus-within:ring-2 focus-within:ring-blue-300`}
            >
              <input
                type="radio"
                name="pricing-tier"
                value={t.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(t.id)}
                className="sr-only"
                aria-describedby={`tier-${t.id}-desc`}
              />
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[14px] font-semibold text-[#1a1d29]">
                  {t.name}
                  {disabled && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 align-middle text-[10.5px] font-medium text-amber-700">Coming soon</span>}
                </span>
                <span className="flex-none whitespace-nowrap text-[14px] font-medium text-[#1a1d29]">
                  ${(t.pricePerMinuteCents / 100).toFixed(2)}<span className="text-[11.5px] font-normal text-gray-400">/min</span>
                </span>
              </span>
              <span id={`tier-${t.id}-desc`} className="mt-1 block text-[12px] leading-[1.45] text-gray-500">
                {t.tagline}
                <span className="mt-0.5 block text-[11px] text-gray-400">{t.carrierMode === 'byo' ? 'Phone carrier billed separately' : 'Phone service included'}</span>
              </span>
            </label>
          );
        })}
      </div>
      {showCarrierNote && (
        <p id="tier-picker-note" className="text-[11.5px] leading-[1.45] text-gray-400">
          {CARRIER_NOTE} Not choosing a plan keeps this agent on its current per-minute price.
        </p>
      )}
      {selectedTier?.lowerQuality && (
        <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] leading-[1.45] text-amber-900" data-testid="lower-quality-accept">
          <input
            type="checkbox"
            checked={lowerQualityAccepted}
            onChange={(e) => onLowerQualityAcceptedChange?.(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {selectedTier.name} uses our lowest-cost voice. It is noticeably lower quality than Standard. I understand and accept that tradeoff for the lower price.
          </span>
        </label>
      )}
      {value && (
        <button type="button" onClick={() => onChange('')} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">
          Clear plan
        </button>
      )}
      {advanced && (
        <details className="rounded-xl border border-gray-200 bg-white" data-testid="tier-advanced">
          <summary className="cursor-pointer select-none rounded-xl px-3 py-2 text-[12.5px] font-medium text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
            Advanced
          </summary>
          <div className="space-y-3 border-t border-gray-100 p-3">{advanced}</div>
        </details>
      )}
    </div>
  );
}
