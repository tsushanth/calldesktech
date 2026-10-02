'use client';

import { useId, useState } from 'react';
import { PRICING_TIERS } from '@/lib/pricingTiers';

// Monthly cost for a given amount of talk time, per tier. Rates come from PRICING_TIERS so this cannot drift from the plans below it.
const PRESETS = [200, 500, 1500, 5000];
const AVERAGE_CALL_MINUTES = 2;

function dollars(cents: number): string {
  const value = cents / 100;
  return value >= 100 ? `$${Math.round(value).toLocaleString('en-US')}` : `$${value.toFixed(2)}`;
}

export function PricingCalculator() {
  const inputId = useId();
  const [minutes, setMinutes] = useState(500);
  const safe = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 1_000_000) : 0;
  const calls = Math.round(safe / AVERAGE_CALL_MINUTES);

  return (
    <section aria-labelledby={`${inputId}-title`} className="min-w-0 rounded-2xl border border-[#00122e]/15 bg-[#f4f4fa] p-6 md:p-7" data-testid="pricing-calculator">
      <h2 id={`${inputId}-title`} className="text-[20px] font-semibold tracking-[-0.02em] text-[#00122e]">What would your calls cost?</h2>
      <label htmlFor={inputId} className="mt-4 block text-[14px] text-gray-600">Talk time per month, in minutes</label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={1000000}
          value={minutes === 0 ? '' : minutes}
          onChange={(e) => setMinutes(e.target.value === '' ? 0 : Number(e.target.value))}
          className="h-11 w-32 rounded-lg border border-gray-300 bg-white px-3 text-[16px] tabular-nums text-[#00122e] focus:border-[#00122e] focus:outline-none focus:ring-2 focus:ring-[#1d3a7a]/30"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Example monthly minutes">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setMinutes(p)}
              aria-pressed={minutes === p}
              className={`h-11 rounded-lg border px-3 text-[14px] tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d3a7a] ${minutes === p ? 'border-[#00122e] bg-[#00122e] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-[#00122e]'}`}
            >
              {p.toLocaleString('en-US')}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[13px] text-gray-500">About {calls.toLocaleString('en-US')} calls at {AVERAGE_CALL_MINUTES} minutes each.</p>

      <dl className="mt-5 divide-y divide-[#00122e]/10 border-y border-[#00122e]/10" aria-live="polite">
        {PRICING_TIERS.map((t) => {
          const soon = t.availability === 'coming_soon';
          return (
            <div key={t.id} className="flex items-baseline justify-between gap-4 py-3">
              <dt className="min-w-0 text-[15px] text-[#00122e]">
                {t.name}
                <span className="ml-2 text-[13px] text-gray-500">{t.pricePerMinuteCents}¢ a minute{soon ? ', coming soon' : ''}</span>
              </dt>
              <dd className={`flex-none text-[20px] font-medium tabular-nums tracking-[-0.02em] ${soon ? 'text-gray-400' : 'text-[#00122e]'}`}>
                {dollars(safe * t.pricePerMinuteCents)}<span className="text-[13px] font-normal text-gray-500"> / month</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-[12px] leading-[1.5] text-gray-500">Talk time only. On Lite and Standard your phone carrier bills its own charges. Pro includes phone service.</p>
    </section>
  );
}
