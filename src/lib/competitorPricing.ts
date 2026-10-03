// Competitor published prices shown on the public compare pages: the single place to refresh them.
// Public prices only, copied from each vendor's own pricing page. Update `retrievedAt` and `source` together with the numbers.
//
// Our side of the table is NOT written here; it is built from src/lib/pricingTiers.ts so it cannot drift.

export type CompetitorTierRow = {
  /** Tier name as the vendor publishes it. */
  name: string;
  /** Published AI-engine rate in cents per minute. */
  centsPerMinute: number;
  /** What the published rate covers. */
  included: string;
  /** What is billed on top, separately. */
  billedSeparately: string;
};

export type CompetitorPricing = {
  vendor: string;
  /** ISO date the prices were read from `source`. */
  retrievedAt: string;
  /** Page the prices were read from. */
  source: string;
  tiers: CompetitorTierRow[];
  /** Other published line items, shown under the table. */
  otherLineItems: string[];
};

export const THUNDERPHONE_PRICING: CompetitorPricing = {
  vendor: 'ThunderPhone',
  retrievedAt: '2026-10-02',
  source: 'https://thunderphone.com/pricing',
  tiers: [
    { name: 'Spark', centsPerMinute: 2, included: 'AI engine', billedSeparately: 'Telephony; premium voices +3¢/min; long prompts +1¢/min' },
    { name: 'Bolt', centsPerMinute: 5, included: 'AI engine', billedSeparately: 'Telephony; premium voices +3¢/min; long prompts +2¢/min' },
    { name: 'Storm', centsPerMinute: 9, included: 'AI engine', billedSeparately: 'Telephony; premium voices +3¢/min; long prompts +2¢/min' },
  ],
  otherLineItems: [
    'Hold time: 2¢/min',
    'Phone numbers from ThunderPhone: $1/month plus 1¢/min inbound',
    'Bring your own carrier or SIP is supported; telephony is not part of the tier rate',
  ],
};

export const COMPETITOR_PRICING = { thunderphone: THUNDERPHONE_PRICING } as const;
