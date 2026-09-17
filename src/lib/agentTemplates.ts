import type { FlowNode } from '@/types';

// Real, working starting-point flows — matching Retell's own Create Agent
// template gallery (see the 2026-09-16 screenshot comparison), but only
// for capabilities this runtime actually has.
//
// Payment collection (Retell's "Insurance Verification" needs this) IS now
// wired up — call-loop-poc's 'payment' node type redirects the live call to
// a real Twilio <Pay> verb, so raw card data never reaches our own server,
// logs, or the LLM's conversation history at all. Still unverified as of
// this template shipping: the exact behavior of our own DTMF handling
// while a Pay session is active on the same call (a real Pay Connector +
// PCI Mode is enabled on the account, but a live end-to-end test with
// actual keypresses hasn't been run yet) — treat this template as "wired
// correctly per the API contract," not "battle-tested," until that happens.
// DTMF/keypad navigation IS now supported
// (see call-loop-poc's twilioAdapter.js 'dtmf' handling) — a caller's
// keypress arrives as a synthetic user turn ("[Caller pressed 1 on the
// keypad]"), so an IVR menu is just a normal node whose edges include
// conditions like "caller pressed 1", no special menu-node type needed.
// Every node type used here (greeting/extraction/function/knowledge_base/
// transfer/goodbye) already runs in production.
//
// Selecting a template in the version editor pre-fills the SAME node-graph
// editor "Conversational flow" mode already uses, not a separate creation
// path — the user reviews/edits before saving, same as picking "Build from
// scratch" just starts from a non-empty state.

export interface AgentTemplate {
  id: string;
  label: string;
  description: string;
  category: string;
  nodes: FlowNode[];
  startNodeId: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'receptionist',
    label: 'Receptionist',
    description: 'Answer questions and route callers to the right outcome.',
    category: 'Receptionist',
    startNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        type: 'greeting',
        prompt:
          'Greet the caller warmly and ask how you can help. Answer any questions about the business (hours, ' +
          'services, pricing, location) directly using what you know about it. Only move to a different step ' +
          'for one of the actionable outcomes listed below.',
        edges: [
          { id: 'e_to_booking', condition: 'caller wants to book or schedule an appointment', target: 'booking' },
          { id: 'e_to_message', condition: 'caller wants to leave a message or have someone call them back', target: 'take_message' },
          { id: 'e_to_transfer', condition: 'caller asks to speak to a real person right away', target: 'transfer' },
          { id: 'e_to_goodbye', condition: 'caller is done and ready to hang up', target: 'goodbye' },
        ],
      },
      {
        id: 'booking',
        type: 'extraction',
        prompt: "Ask for the caller's name and their preferred appointment date/time.",
        extract: { name: 'string', preferred_time: 'string' },
        edges: [{ id: 'e_booking_done', condition: 'both name and preferred_time have been collected', target: 'goodbye' }],
      },
      {
        id: 'take_message',
        type: 'extraction',
        prompt: "Apologize that no one is available right now, then ask for the caller's name, callback number, and a brief reason for their call.",
        extract: { name: 'string', callback_number: 'string', reason: 'string' },
        edges: [{ id: 'e_message_done', condition: 'name, callback_number, and reason have all been collected', target: 'goodbye' }],
      },
      {
        id: 'transfer',
        type: 'transfer',
        prompt: "Let the caller know you're connecting them now.",
        params: { transferTo: '' },
        edges: [],
      },
      { id: 'goodbye', type: 'goodbye', prompt: 'Thank the caller for calling and say a warm goodbye.', edges: [] },
    ],
  },
  {
    id: 'appointment-booking',
    label: 'Appointment Booking',
    description: 'Focused booking flow — collect name, resolve a real date/time, confirm before closing.',
    category: 'Appointment Booking',
    startNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        type: 'greeting',
        prompt:
          "Greet the caller as the business's AI receptionist. If they want to book an appointment, don't just " +
          'acknowledge it and move on — ask for their name and preferred date/time yourself, in that same reply, ' +
          'before transitioning.',
        edges: [{ id: 'e_to_booking', condition: 'caller wants to book or schedule an appointment', target: 'booking' }],
      },
      {
        id: 'booking',
        type: 'extraction',
        prompt: "Ask for the caller's name and their preferred appointment date/time.",
        extract: { name: 'string', preferred_time: 'string' },
        edges: [{ id: 'e_booking_done', condition: 'both name and preferred_time have been collected and confirmed', target: 'goodbye' }],
      },
      { id: 'goodbye', type: 'goodbye', prompt: 'Confirm the booking details one last time, thank the caller, and say goodbye.', edges: [] },
    ],
  },
  {
    id: 'message-taking',
    label: 'Message Taking',
    description: 'No one available — collect name, callback number, and reason for the call.',
    category: 'Receptionist',
    startNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        type: 'greeting',
        prompt: 'Greet the caller and let them know you can take a message since no one is available right now.',
        edges: [{ id: 'e_to_message', condition: 'always', target: 'take_message' }],
      },
      {
        id: 'take_message',
        type: 'extraction',
        prompt: "Ask for the caller's name, a callback number, and a brief reason for their call.",
        extract: { name: 'string', callback_number: 'string', reason: 'string' },
        edges: [{ id: 'e_message_done', condition: 'name, callback_number, and reason have all been collected', target: 'goodbye' }],
      },
      { id: 'goodbye', type: 'goodbye', prompt: "Let the caller know someone will call them back, thank them, and say goodbye.", edges: [] },
    ],
  },
  {
    id: 'outbound-sales-reactivation',
    label: 'Outbound Sales & Reactivation',
    description: 'Outbound call to re-engage a lead or past customer — qualify interest, offer a callback if not now.',
    category: 'Outbound Sales & Reactivation',
    startNodeId: 'opening',
    nodes: [
      {
        id: 'opening',
        type: 'greeting',
        prompt:
          'You are calling on behalf of the business to re-engage a past customer or lead. Introduce yourself and ' +
          'the reason for the call in one or two sentences, then gauge interest.',
        edges: [
          { id: 'e_to_qualify', condition: 'prospect is engaged and willing to talk', target: 'qualify' },
          { id: 'e_to_callback', condition: 'prospect asks to be called back at a better time', target: 'callback' },
          { id: 'e_to_goodbye', condition: 'prospect is not interested or asks to be removed from calls', target: 'goodbye' },
        ],
      },
      {
        id: 'qualify',
        type: 'extraction',
        prompt: "Ask what they're looking for and their preferred time to follow up or come in.",
        extract: { name: 'string', interest: 'string', preferred_time: 'string' },
        edges: [{ id: 'e_qualify_done', condition: 'name, interest, and preferred_time have all been collected', target: 'goodbye' }],
      },
      {
        id: 'callback',
        type: 'extraction',
        prompt: 'Ask when would be a better time to reach them.',
        extract: { preferred_callback_time: 'string' },
        edges: [{ id: 'e_callback_done', condition: 'preferred_callback_time has been collected', target: 'goodbye' }],
      },
      { id: 'goodbye', type: 'goodbye', prompt: 'Thank them for their time and say goodbye.', edges: [] },
    ],
  },
  {
    id: 'ivr-navigation',
    label: 'IVR Navigation',
    description: 'Keypad menu — press 1 for sales, 2 for support, 0 for a person. Also accepts spoken requests.',
    category: 'IVR Navigation',
    startNodeId: 'menu',
    nodes: [
      {
        id: 'menu',
        type: 'greeting',
        prompt:
          'Greet the caller, then say: "Press 1 for sales, press 2 for support, or press 0 to speak with someone." ' +
          "A caller can also just say what they want instead of pressing a key — don't require the keypad if " +
          'they speak their intent clearly.',
        edges: [
          { id: 'e_to_sales', condition: 'caller pressed 1, or says they want sales/pricing/to buy something', target: 'sales' },
          { id: 'e_to_support', condition: 'caller pressed 2, or says they need help/support with something', target: 'support' },
          { id: 'e_to_transfer', condition: 'caller pressed 0, or asks to speak to a real person', target: 'transfer' },
        ],
      },
      {
        id: 'sales',
        type: 'extraction',
        prompt: "Ask for the caller's name and what they're interested in.",
        extract: { name: 'string', interest: 'string' },
        edges: [{ id: 'e_sales_done', condition: 'name and interest have both been collected', target: 'goodbye' }],
      },
      {
        id: 'support',
        type: 'extraction',
        prompt: "Ask for the caller's name and a brief description of the issue.",
        extract: { name: 'string', issue: 'string' },
        edges: [{ id: 'e_support_done', condition: 'name and issue have both been collected', target: 'goodbye' }],
      },
      {
        id: 'transfer',
        type: 'transfer',
        prompt: "Let the caller know you're connecting them now.",
        params: { transferTo: '' },
        edges: [],
      },
      { id: 'goodbye', type: 'goodbye', prompt: 'Thank the caller and say goodbye.', edges: [] },
    ],
  },
  {
    id: 'payment-collection',
    label: 'Payment Collection',
    description: 'Collect a payment or verify a card on file — hands off to Twilio\'s <Pay>, never touches raw card data.',
    category: 'Payment Collection',
    startNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        type: 'greeting',
        prompt: 'Greet the caller and ask how you can help — mention that you can take a payment or verify a card on file if needed.',
        edges: [{ id: 'e_to_payment', condition: 'caller wants to make a payment or provide card details', target: 'payment' }],
      },
      {
        id: 'payment',
        type: 'payment',
        prompt: 'Let the caller know you\'re securely transferring them to enter their card details now — they should follow the prompts they hear.',
        params: { amount: '0', paymentConnector: 'Default' },
        edges: [
          { id: 'e_payment_success', condition: 'payment succeeded', target: 'confirm' },
          { id: 'e_payment_failed', condition: 'payment failed or was canceled', target: 'failed' },
        ],
      },
      { id: 'confirm', type: 'goodbye', prompt: "Confirm the payment was received, thank the caller, and say goodbye.", edges: [] },
      { id: 'failed', type: 'goodbye', prompt: "Let the caller know the payment didn't go through and they may want to try again or call back, then say goodbye.", edges: [] },
    ],
  },
];
