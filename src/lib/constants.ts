// Demo profiles for quick onboarding demos
export const DEMO_PROFILES = {
  plumber: {
    id: 'plumber',
    businessName: "Mike's Plumbing",
    businessType: 'plumbing',
    displayName: 'Blue Collar Pro',
    voiceId: '11labs-Adrian',
    voiceStyle: 'Warm, trustworthy male voice',
    greeting: "Hey there! Thanks for calling Mike's Plumbing. How can I help you today?",
    icon: '🔧',
    color: 'bg-blue-500',
  },
  salon: {
    id: 'salon',
    businessName: "Bella's Hair Studio",
    businessType: 'salon',
    displayName: 'Chic & Friendly',
    voiceId: '11labs-Marissa',
    voiceStyle: 'Friendly, upbeat female voice',
    greeting: "Hi there! Welcome to Bella's Hair Studio. I'd love to help you book your next appointment!",
    icon: '💇‍♀️',
    color: 'bg-pink-500',
  },
  medical: {
    id: 'medical',
    businessName: 'Sunrise Family Clinic',
    businessType: 'medical',
    displayName: 'Calm & Professional',
    voiceId: '11labs-Adrian',
    voiceStyle: 'Calm, professional voice',
    greeting: 'Hello, thank you for calling Sunrise Family Clinic. How may I assist you today?',
    icon: '🏥',
    color: 'bg-green-500',
  },
  restaurant: {
    id: 'restaurant',
    businessName: "Mama Rosa's Kitchen",
    businessType: 'restaurant',
    displayName: 'Warm & Inviting',
    voiceId: '11labs-Marissa',
    voiceStyle: 'Warm, motherly voice',
    greeting: "Ciao! Welcome to Mama Rosa's Kitchen. Are you looking to make a reservation, dear?",
    icon: '🍝',
    color: 'bg-orange-500',
  },
  auto: {
    id: 'auto',
    businessName: "Joe's Auto Repair",
    businessType: 'auto_repair',
    displayName: 'Mechanic Expert',
    voiceId: '11labs-Adrian',
    voiceStyle: 'Knowledgeable, friendly voice',
    greeting: "Thanks for calling Joe's Auto Repair! How can we help with your vehicle today?",
    icon: '🚗',
    color: 'bg-gray-500',
  },
} as const;

export type DemoProfileId = keyof typeof DEMO_PROFILES;
export type DemoProfile = (typeof DEMO_PROFILES)[DemoProfileId];

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

// Pricing info
export const PRICING = {
  monthly: {
    price: 49,
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
