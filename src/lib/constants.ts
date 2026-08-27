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
// NOTE 2026-08-26: this flat-plan display was showing $49 while the actual
// live Stripe price customers get charged (STRIPE_PRICE_ID,
// price_1SekfDKFBTQTkmzt9Qx2rYWY) is $39 — fixed to match. This whole flat
// plan is also slated for replacement by usage-based metered pricing (see
// the new "CallDeskTech Usage" product / calldesktech_* meters created the
// same day) — the checkout/dashboard billing UI has NOT been migrated to
// that yet, so this flat price is still what /pricing actually charges.
export const PRICING = {
  monthly: {
    price: 39,
    features: [
      'Dedicated phone number',
      '100 minutes/month included',
      'Custom knowledge base',
      'Appointment booking',
      'Call transcripts & analytics',
      'SMS confirmations',
    ],
  },
  overage: {
    perMinute: 0.10,
    perSms: 0.05,
  },
} as const;

// Voice options for Retell AI
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
