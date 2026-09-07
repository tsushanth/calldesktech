// Capability demos — each showcases exactly ONE building block (see
// src/lib/flowBuilder.ts) in isolation, rather than a whole business
// persona. Replaces the old business-type demos (plumber/salon/medical/
// restaurant/auto) per the product decision 2026-08-26: a prospect should
// see what a specific capability does before choosing which ones to buy for
// their own business on /demo/focused/blocks, not just "a demo of a plumber."
// `block` maps each demo onto flowBuilder's WizardBlocks keys — 'faq' has no
// corresponding key because it's the always-on baseline itself.
export const CAPABILITY_DEMOS = {
  faq: {
    id: 'faq',
    businessName: 'Golden Gate Dental',
    businessType: 'dental',
    displayName: 'Answers FAQs',
    block: null,
    voiceId: '11labs-Adrian',
    voiceStyle: 'Calm, professional voice',
    greeting: 'Hello, thank you for calling Golden Gate Dental. How can I help you today?',
    icon: '💬',
    color: 'bg-blue-500',
  },
  booking: {
    id: 'booking',
    businessName: 'Riverside Fitness',
    businessType: 'fitness',
    displayName: 'Books appointments',
    block: 'booking',
    voiceId: '11labs-Marissa',
    voiceStyle: 'Friendly, upbeat female voice',
    greeting: "Hi there! Welcome to Riverside Fitness — I'd love to help you book a session!",
    icon: '📅',
    color: 'bg-green-500',
  },
  transfer: {
    id: 'transfer',
    businessName: 'Summit Legal Group',
    businessType: 'legal',
    displayName: 'Transfers to a human',
    block: 'transfer',
    voiceId: '11labs-Adrian',
    voiceStyle: 'Calm, professional voice',
    greeting: 'Thank you for calling Summit Legal Group. How may I direct your call?',
    icon: '📞',
    color: 'bg-purple-500',
  },
  message: {
    id: 'message',
    businessName: 'Bay Area Realty',
    businessType: 'real_estate',
    displayName: 'Takes a message',
    block: 'takeMessage',
    voiceId: '11labs-Marissa',
    voiceStyle: 'Warm, friendly voice',
    greeting: "Hi! You've reached Bay Area Realty — how can I help you today?",
    icon: '📝',
    color: 'bg-orange-500',
  },
} as const;

export type DemoProfileId = keyof typeof CAPABILITY_DEMOS;
export type DemoProfile = (typeof CAPABILITY_DEMOS)[DemoProfileId];

// Call status states
export const CALL_STATUSES = {
  initiated: { label: 'Initiating...', color: 'text-gray-500' },
  queued: { label: 'Connecting...', color: 'text-gray-500' },
  ringing: { label: 'Ringing...', color: 'text-yellow-500' },
  'in-progress': { label: 'In Progress', color: 'text-green-500' },
  completed: { label: 'Completed', color: 'text-green-600' },
  failed: { label: 'Failed', color: 'text-red-500' },
  busy: { label: 'Busy', color: 'text-orange-500' },
  'no-answer': { label: 'No Answer', color: 'text-orange-500' },
} as const;

export type CallStatus = keyof typeof CALL_STATUSES;

// Per-block add-on prices for the à la carte building-block picker
// (onboarding + dashboard settings). PLACEHOLDER VALUES — not wired to
// Stripe yet, deliberately, per product decision 2026-08-26: build the
// selection mechanism now, price it for real later. FAQ/KB has no entry
// because it's the always-on baseline, not a paid add-on.
export const BLOCK_PRICES = {
  booking: 15,
  transfer: 20,
  takeMessage: 10,
} as const;

// Pricing info
// 2026-08-26: replaced the old flat $39/mo plan with real usage-based
// pricing — $0 base, pay only for what's used, undercutting Retell's
// effective $0.07-0.31/min by 4-30x on our actual measured infra cost (see
// costTracker.js). Mirrors Retell's own "$0 base + stacked per-minute"
// model rather than a flat-plan-plus-overage. Backed by live metered
// Stripe prices on product "CallDeskTech Usage" (voice priced per backend,
// since only one price per meter can be attached to a subscription at once
// — see syncVoicePriceForTenant in lib/stripe.ts, which swaps it):
//   price_1U8tJeKFBTQTkmztTPNMcLKe  kokoro_voice_seconds     $0.02/min
//   price_1U8tJfKFBTQTkmztIu8fXDxa  elevenlabs_voice_seconds $0.08/min
//   price_1UCsz6KFBTQTkmztuAOaxCRM  cartesia_voice_seconds   $0.08/min
//   price_1UCszEKFBTQTkmztXKqkApW7  minimax_voice_seconds    $0.16/min
//   price_1U8tJtKFBTQTkmzt8CqFVIDs  booking_completed        $0.007/event
//   price_1U8tJtKFBTQTkmztdgtdAu8n  transfer_completed       $0.01/event
//   price_1U8tJuKFBTQTkmztzhIqUrg3  message_taken            $0.004/event
// cartesia/minimax rates (added 2026-09-06) apply the same markup ElevenLabs
// already carries — 1.82x its real per-minute cost at ElevenLabs Flash
// v2.5's published $0.05/1000-char rate, using ~880 chars/min (empirically
// derived from MiniMax's own docs example) to convert characters to audio
// time. Cartesia's Sonic pay-as-you-go rate is identical to ElevenLabs's
// ($0.05/1000 chars), so it lands on the same $0.08/min; MiniMax's
// speech-2.8-hd is 2x that raw cost ($0.10/1000 chars), so it's 2x the price.
// The old flat plan (price_1SekfDKFBTQTkmzt9Qx2rYWY, prod_TbyctCCfmAN34Q)
// stays live only for whoever already subscribed to it before this switch —
// new checkouts go on the usage-based plan below.
export const USAGE_PRICES = {
  voice: {
    kokoro: 'price_1U8tJeKFBTQTkmztTPNMcLKe',
    elevenlabs: 'price_1U8tJfKFBTQTkmztIu8fXDxa',
    cartesia: 'price_1UCsz6KFBTQTkmztuAOaxCRM',
    minimax: 'price_1UCszEKFBTQTkmztXKqkApW7',
  },
  booking: 'price_1U8tJtKFBTQTkmzt8CqFVIDs',
  transfer: 'price_1U8tJtKFBTQTkmztdgtdAu8n',
  message: 'price_1U8tJuKFBTQTkmztzhIqUrg3',
} as const;

export const PRICING = {
  usage: {
    voicePerMinute: { kokoro: 0.02, elevenlabs: 0.08, cartesia: 0.08, minimax: 0.16 },
    perBookingEvent: 0.007,
    perTransferEvent: 0.01,
    perMessageEvent: 0.004,
    features: [
      'Dedicated phone number',
      'Pay only for call minutes and completed actions — no monthly minimum',
      'Custom knowledge base',
      'Appointment booking, live transfer, and message-taking add-ons',
      'Call transcripts & analytics',
    ],
  },
} as const;

// Fallback voice options — only shown if GET /api/retell/voices (Retell's
// real multi-provider catalog: elevenlabs, openai, cartesia, minimax,
// fish_audio, platform — see src/lib/retell.ts's listVoices) fails to load.
// Not "the" voice list; Retell isn't tied to ElevenLabs and neither is this
// app anymore.
export const VOICE_OPTIONS = [
  { id: '11labs-Adrian', name: 'Adrian', description: 'Professional male voice', gender: 'male' },
  { id: '11labs-Marissa', name: 'Marissa', description: 'Friendly female voice', gender: 'female' },
] as const;

// Tone options
export const TONE_OPTIONS = [
  { id: 'professional', label: 'Professional', description: 'Formal and business-like' },
  { id: 'friendly', label: 'Friendly', description: 'Warm and approachable' },
  { id: 'casual', label: 'Casual', description: 'Relaxed and conversational' },
] as const;

// Business types for onboarding
export const BUSINESS_TYPES = [
  { id: 'auto_repair', label: 'Auto Repair / Mechanic' },
  { id: 'salon', label: 'Salon / Spa' },
  { id: 'medical', label: 'Medical / Healthcare' },
  { id: 'restaurant', label: 'Restaurant / Food Service' },
  { id: 'plumbing', label: 'Plumbing / HVAC' },
  { id: 'legal', label: 'Legal Services' },
  { id: 'real_estate', label: 'Real Estate' },
  { id: 'fitness', label: 'Fitness / Gym' },
  { id: 'other', label: 'Other' },
] as const;
