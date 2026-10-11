import { PRICING_TIERS, INCLUDED_ON_ALL, ratingsForStack, type TierId } from '@/lib/pricingTiers';
import { EXPERT_BACKUP, expertBackupAllowedTierNames, expertBackupPriceText } from '@/lib/expertBackup';
import { NUMBER_ADDON_PRICES, NUMBER_CARRIERS, type NumberCarrier } from '@/lib/numberAddOn';
import { AGENT_LANGUAGES } from '@/lib/languages';
import { centsLabel, centsWords } from '@/lib/pricingCopy';

/**
 * The ONE source of truth for every statement the comparison, alternatives, migration, industry and use-case pages make about
 * Calldesk. Templates in src/lib/seoLibrary must read from here and never type a Calldesk price, plan, feature or claim themselves
 * (test/lib/seoLibrary/templates.test.ts scans the template sources for digits and cents amounts to enforce that).
 *
 * How it is derived: prices, tiers, ratings, what every plan includes, phone-number prices, expert backup and the language list are
 * IMPORTED from the same files the live /pricing page, the API (GET /pricing) and the docs read (src/lib/pricingTiers.ts,
 * numberAddOn.ts, expertBackup.ts, languages.ts), so this file cannot drift from them. The few things that have no single constant
 * (API, webhooks, MCP) are typed below with the file that backs each one. Anything we could not confirm from code is NOT here; it
 * is listed in UNVERIFIED so the next person sees what was left out on purpose.
 *
 * Public repo rules: customer-facing facts only. No costs, margins, vendor rates or engine/model names.
 */

export const CALLDESK_NAME = 'Calldesk';
export const CALLDESK_SITE = 'https://calldesk.tech';
export const CALLDESK_SUPPORT_EMAIL = 'support@calldesk.tech';

/**
 * Certifications Calldesk may state on these pages. EMPTY ON PURPOSE: today the compliance gap analysis (docs/compliance) records no
 * certification of any kind. Add an entry (for example 'soc2') only after the owner has a real audit report, and say where it is
 * published. The validator fails any page that states a certification not listed here.
 */
export const CALLDESK_CERTIFICATION_ALLOW_LIST: readonly string[] = [];

export type TierFact = {
  id: TierId;
  name: string;
  centsPerMinute: number;
  /** "2¢" */
  priceLabel: string;
  /** "$0.02" */
  priceDollars: string;
  tagline: string;
  whoItsFor: string;
  voice: string;
  responseSpeed: string;
  reasoning: string;
  englishOnlyVoice: boolean;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Only tiers that can be bought today are described as available (a tier marked coming_soon would be left out here).
export const TIERS: readonly TierFact[] = PRICING_TIERS.filter((t) => t.availability === 'live').map((t) => {
  const r = ratingsForStack(t.stack);
  return {
    id: t.id,
    name: t.name,
    centsPerMinute: t.pricePerMinuteCents,
    priceLabel: centsLabel(t.pricePerMinuteCents),
    priceDollars: dollars(t.pricePerMinuteCents),
    tagline: t.tagline,
    whoItsFor: t.whoItsFor,
    voice: r.voice,
    responseSpeed: r.responseSpeed,
    reasoning: r.reasoning,
    englishOnlyVoice: t.stack.ttsBackend === 'piper',
  };
});

const CARRIER_LABEL: Record<NumberCarrier, string> = { telnyx: 'Telnyx', twilio: 'Twilio' };

export const PHONE_NUMBERS = {
  /** Bringing your own number or carrier costs nothing extra on every plan (pricingTiers.ts CARRIER_NOTE, numberAddOn.ts). */
  bringYourOwnIsFree: true,
  options: [...NUMBER_CARRIERS]
    .sort((a, b) => NUMBER_ADDON_PRICES[a].monthlyCents - NUMBER_ADDON_PRICES[b].monthlyCents)
    .map((c) => ({
      carrier: CARRIER_LABEL[c],
      monthly: `${dollars(NUMBER_ADDON_PRICES[c].monthlyCents)} per month per number`,
      inbound: `${centsWords(NUMBER_ADDON_PRICES[c].inboundCentsPerMinute)} per inbound minute`,
    })),
  outboundUsesYourOwnCarrier: true,
} as const;

export const EXPERT_BACKUP_FACT = {
  label: EXPERT_BACKUP.label,
  tiers: expertBackupAllowedTierNames(),
  price: expertBackupPriceText(),
  summary: 'hands the turns your agent is unsure about to a stronger model for better accuracy on hard turns',
} as const;

const NON_ENGLISH = AGENT_LANGUAGES.length;
export const LANGUAGES = {
  /** English plus every code in AGENT_LANGUAGES. */
  totalCount: NON_ENGLISH + 1,
  nonEnglishCount: NON_ENGLISH,
  /** The wording the pricing page uses ("40+ languages", INCLUDED_ON_ALL). Pages say this, not an exact count, so no one has to keep a number current. test/lib/seoLibrary checks totalCount stays above it. */
  headline: '40+ languages',
  headlineFloor: 40,
  /** The English-only tier's voice cannot speak other languages; they need a tier in nonEnglishTierNames (INCLUDED_ON_ALL says so). */
  nonEnglishNeedsStandardOrPro: true,
  /** Plans whose voice speaks other languages, and plans whose voice speaks English only (from each tier's voice backend). */
  nonEnglishTierNames: TIERS.filter((t) => !t.englishOnlyVoice).map((t) => t.name),
  englishOnlyTierNames: TIERS.filter((t) => t.englishOnlyVoice).map((t) => t.name),
} as const;

export const BILLING = {
  noMonthlyMinimum: true,
  /** Stated on /pricing: "no per-booking or per-transfer fees". */
  noPerBookingOrTransferFees: true,
  cancelAnytime: true,
  addOnsComingSoon: true,
} as const;

export const DEVELOPER = {
  restApi: true,
  mcpServer: true,
  /** src/lib/openapi.ts, POST /tenants/{id}/webhooks. call.started is Retell-engine only and left out. */
  webhookEvents: ['call.completed', 'call.transferred', 'call.analyzed'],
  webhooksSigned: true,
  webhookFlatFormat: true,
  docsPath: '/docs',
  highlevelDocsPath: '/docs/highlevel',
} as const;

export const COMPLIANCE_FACTS = {
  /** Always empty until CALLDESK_CERTIFICATION_ALLOW_LIST has entries. */
  certificationsClaimed: CALLDESK_CERTIFICATION_ALLOW_LIST,
  /** The sentence every page uses. Built so it states no certification. */
  statement: 'Calldesk does not currently claim any compliance certification, so if your industry requires one, ask us what we can show you before you rely on it.',
} as const;

/** Features every plan has (verbatim from pricingTiers.ts INCLUDED_ON_ALL). */
export const INCLUDED_ON_EVERY_PLAN: readonly string[] = INCLUDED_ON_ALL;

/**
 * Features pages may name. Each is backed by code. The validator warns when an industry or use-case page names a feature
 * that is not in this vocabulary, so a writer cannot quietly invent one.
 */
export const FEATURE_VOCABULARY: readonly { name: string; backedBy: string }[] = [
  { name: 'Call summary', backedBy: 'INCLUDED_ON_ALL' },
  { name: 'Full transcript', backedBy: 'INCLUDED_ON_ALL' },
  { name: 'Structured field extraction', backedBy: 'INCLUDED_ON_ALL' },
  { name: 'Call transfers', backedBy: 'INCLUDED_ON_ALL' },
  { name: 'Keypad tones (DTMF)', backedBy: 'INCLUDED_ON_ALL' },
  { name: 'Knowledge base', backedBy: 'INCLUDED_ON_ALL' },
  { name: 'Calendar booking', backedBy: 'INCLUDED_ON_ALL; live booking goes through a Cal.com connection (src/lib/calendarConnection.ts)' },
  { name: 'Call testing', backedBy: 'INCLUDED_ON_ALL; test calls from the agent page (src/app/dashboard/agents/[id]/page.tsx, place-call route in src/lib/openapi.ts)' },
  { name: 'Live Calls page', backedBy: 'src/app/dashboard/live-monitoring/page.tsx: calls in progress, duration, current flow step and a coarse sentiment label. It is call STATE, not audio: nobody can listen in. Pages must not say listen, watch or monitor audio' },
  { name: 'API and MCP server', backedBy: 'INCLUDED_ON_ALL' },
  { name: 'Multiple languages', backedBy: 'src/lib/languages.ts' },
  { name: '40+ languages', backedBy: 'INCLUDED_ON_ALL and AGENT_LANGUAGES in src/lib/languages.ts (non-English needs Standard or Pro)' },
  { name: 'Standard and Pro voices', backedBy: 'src/lib/pricingTiers.ts (Lite voice is English-only; LANGUAGES.nonEnglishTierNames)' },
  { name: 'Webhooks', backedBy: 'src/lib/openapi.ts' },
  { name: 'Outbound calls', backedBy: 'src/lib/openapi.ts (place an outbound call)' },
  { name: 'Per-call variables', backedBy: 'src/lib/openapi.ts POST place call: optional variables object fills {{placeholders}} for that call (limits: 25 keys, 4000 bytes)' },
  { name: 'Batch calls', backedBy: 'src/lib/openapi.ts (batch calls)' },
  { name: 'Per-contact variables', backedBy: 'src/lib/openapi.ts and src/lib/mcp/tools.ts create_batch_call: CSV columns other than the phone column become per-call variables' },
  { name: 'Batch call time window', backedBy: 'src/lib/openapi.ts callTimeWindow { timezone, days, start_hour, end_hour } and scheduledAt for running a batch later' },
  { name: 'Voicemail detection', backedBy: 'agent page voicemailDetection setting (hang up, or leave the message you wrote): src/app/dashboard/agents/[id]/page.tsx; landing Platform.tsx' },
  { name: 'Staging and production environments', backedBy: 'src/lib/openapi.ts (promote a version); GUIDE in src/lib/mcp/tools.ts' },
  { name: 'Environments', backedBy: 'GUIDE in src/lib/mcp/tools.ts (staging/production, promote_agent_environment, set_number_routing environmentId)' },
  { name: 'Expert backup', backedBy: 'src/lib/expertBackup.ts' },
  { name: 'Phone numbers', backedBy: 'src/lib/numberAddOn.ts' },
  { name: 'Existing number with call forwarding', backedBy: 'src/app/api/tenants/[id]/phone-numbers/route.ts (register a number you own; route it via carrier call forwarding) and the landing FAQ in src/components/landing/Closing.tsx. No SIP trunking' },
  { name: 'Per-minute billing', backedBy: 'src/lib/pricingTiers.ts (a price per minute of talk time, no monthly minimum)' },
  { name: 'Flow builder', backedBy: 'src/components/flow-builder' },
  { name: 'Agent templates', backedBy: 'GET /agent-templates in src/lib/openapi.ts' },
  { name: 'Logic split', backedBy: 'GUIDE in src/lib/mcp/tools.ts (logic_split node with structured edge conditions); handled in src/lib/retellFlow.ts' },
  { name: 'Edge conditions', backedBy: 'GUIDE in src/lib/mcp/tools.ts (plain-English conditions judged by the model, or structured field tests on a logic split)' },
  { name: 'Code step', backedBy: 'GUIDE in src/lib/mcp/tools.ts (code node: JavaScript sandbox with dv, fetch and localTime(tz)); src/lib/flowCodeSandbox.ts; business-hours example in src/lib/agentTemplates.ts' },
  { name: 'Function step', backedBy: 'GUIDE in src/lib/mcp/tools.ts (function node: webhook POSTs { function, collectedData } and folds the result into context)' },
  { name: 'Knowledge-base step', backedBy: 'GUIDE in src/lib/mcp/tools.ts (knowledge_base node answers from the agent\'s attached knowledge base)' },
  { name: 'Agent transfer', backedBy: 'GUIDE in src/lib/mcp/tools.ts (agent_transfer node hands the live call to another agent in the workspace)' },
  { name: 'Simulation test cases', backedBy: 'src/lib/openapi.ts (test-cases: persona + success criteria, run a simulation); Simulation tab in the agent page' },
  { name: 'HubSpot caller lookup', backedBy: 'src/lib/openapi.ts crm/hubspot/lookup and lookup_hubspot_contact in src/lib/mcp/tools.ts (needs a connected HubSpot; on-demand lookup by phone, no background sync)' },
  { name: 'Call-issue checks', backedBy: 'src/lib/callIssues.ts (deterministic checks after the call: claimed booking without tool, placeholder read aloud, number readback mismatch, no fields collected, long silence)' },
  { name: 'HighLevel recipe', backedBy: 'src/lib/highlevelRecipe.ts and /docs/highlevel (two workflows via webhooks)' },
  { name: 'requireBookingTools', backedBy: 'src/app/docs/page.tsx and src/app/api/agents/[id]/versions/route.ts (publish warns when a flow books with no calendar; requireBookingTools: true refuses with 422)' },
];

/**
 * Coordinator-verified 2026-10-10 and re-checked against the code. Pages may state these and nothing stronger.
 */
export const VERIFIED_STATEMENTS = {
  /** Calendars connect through Cal.com (src/lib/calendarConnection.ts). Google, Outlook and iCal calendars are reached through Cal.com; a Cal.com account is needed. */
  calendar: 'Calendars connect through Cal.com (Google, Outlook and iCal calendars via Cal.com). A Cal.com account is needed.',
  /** Dashboard "Port an existing number" form submits a Twilio port-in request (src/app/dashboard/numbers/page.tsx). No port has been completed yet, so pages must not promise porting. */
  porting: { exists: true, viaTwilioPortInRequest: true, completedPortsToDate: 0, mayBePromisedOnPages: false },
  /** src/app/api/tenants/[id]/phone-numbers/route.ts: "until full SIP trunking is configured". */
  sipTrunking: false,
  numberAddOnsLiveOnPricing: true,
  /** Priced on /pricing from the numberAddOn.ts constants (PHONE_NUMBERS.options). */
  expertBackupTiers: 'Lite and Standard',
  otherAddOnsComingSoon: ['advanced analytics', 'premium voice'],
  allThreeTiersLive: true,
  freeOffer: 'a free demo call, with no trial credit',
} as const;

/** Never state any of these on a page: Calldesk has not published them. */
export const NOT_PUBLISHED: readonly string[] = [
  'concurrent call limits',
  'uptime',
  'latency',
  'call recording retention',
  'data residency',
  'encryption',
  'a data processing agreement (DPA)',
  'a business associate agreement (BAA)',
  'any certification',
];

/**
 * Things a writer might expect to see here that we could not confirm from the code, left out on purpose. Delete a line once it is
 * verified and added above.
 */
export const UNVERIFIED: readonly string[] = [
  'SIP trunking: NOT offered (phone-numbers route says "until full SIP trunking is configured"). A number you own is registered and reached by carrier call forwarding.',
  'Number porting: the dashboard has a "Port an existing number" form that submits a Twilio port-in request, but no port has been completed yet. Do not promise porting on pages.',
  'Which calendars connect beyond Cal.com: Google, Outlook and iCal are reached through Cal.com (coordinator-verified 2026-10-10; the repo only shows the Cal.com connection). A Cal.com account is needed.',
  'Concurrent call limits, uptime commitments and latency figures: not published.',
  'Call recording retention periods and where recordings are stored: not published.',
  'Data residency, encryption at rest, a data processing agreement, a business associate agreement, any certification: none confirmed (docs/compliance/readiness-gap-analysis.md).',
  'A free trial: the offer is a free demo call, not a trial with credit.',
  'Add-on prices for advanced analytics and premium voice: announced as coming soon, with no amounts. Number add-ons and expert backup are live and priced.',
  'Listening to a live call: not possible. The Live Calls page shows call state (in progress, duration, flow step, coarse sentiment), not audio.',
  'localTime(tz) in the code step is documented in the agent page and used by built-in templates, but the engine that implements it (call-loop-poc) is outside this repo, so it was not read here.',
  'Google, Outlook and iCal behaviour inside Cal.com is Cal.com\'s own; pages say "via Cal.com" and nothing more.',
];

export const TIER_SUMMARY_LINE = TIERS.map((t) => `${t.name} ${t.priceLabel}`).join(', ');
export const TIER_RANGE_LABEL = `${TIERS[0].priceLabel} to ${TIERS[TIERS.length - 1].priceLabel}`;
