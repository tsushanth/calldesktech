import type { FlowNode } from '@/types';

// Real, working starting-point flows — matching Retell's own Create Agent
// template gallery (see the 2026-09-16 screenshot comparison), but only
// for capabilities this runtime actually has. Deliberately NOT included:
// Retell's "Insurance Verification" and "IVR Navigation/Payment" templates
// depend on DTMF/keypad navigation and payment processing, neither of
// which call-loop-poc supports yet (see README's "Known POC gaps") — a
// template that can't actually do what its name promises is worse than no
// template. Every node type used here (greeting/extraction/function/
// knowledge_base/transfer/goodbye) already runs in production.
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
];
