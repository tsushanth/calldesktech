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
  // Retell ships every template as BOTH a single giant prompt AND an
  // equivalent conversation-flow graph — the same underlying behavior,
  // two different editing surfaces. Optional since most of our existing
  // templates predate this and are simple enough that the flow IS the
  // natural form; only added where a real single-prompt version exists to
  // compare against (see insurance-verification-caller).
  singlePrompt?: string;
}

// A subflow_ref node's referenced subflow doesn't exist yet at template
// definition time (subflows are real tenant-scoped DB rows, created at
// apply time) — so a template embeds the subflow's own nodes/start id
// directly on the node via these template-only params, and applyTemplate
// (agents/[id]/page.tsx) POSTs a real calldesk_subflows row for each one
// before handing the nodes to the editor, then rewrites the node's params
// to a real subflowId (see materializeTemplateSubflows).
export interface TemplateSubflowSeed {
  name: string;
  nodes: FlowNode[];
  startNodeId: string;
}

// The IVR-navigation portion of Insurance Verification Caller, factored out
// as a subflow — matches Retell's own template, where this exact block
// ("IVR Navigation And Provider Auth") is a reusable Agent Subflow rather
// than inline nodes. Real subroutine semantics (see call-loop-poc's
// _enterSubflow): reaching either of its own terminal nodes below hands
// control back to the ivr_navigation subflow_ref node's own two edges in
// the main flow (reached-a-rep vs. closed/unreachable) — the model picks
// whichever actually matches what happened on the call.
const IVR_NAVIGATION_SUBFLOW_SEED: TemplateSubflowSeed = {
  name: 'IVR Navigation And Provider Auth',
  startNodeId: 'listen',
  nodes: [
    {
      id: 'listen',
      type: 'greeting',
      prompt:
        'When the call connects and an automated system answers, do not speak — listen to each prompt carefully. Navigate toward ' +
        'Eligibility and Benefits, Provider Services, Authorizations, or (only if those are unavailable) Claims. Avoid Member Services, ' +
        'Billing, Medical Records, and clinical departments. Speak menu options out loud when the IVR is speech-driven; use a keypad press ' +
        'when it is DTMF-driven. If asked to say your NPI, provide a natural variation of "{{provider_npi}}". If told to hold, respond ' +
        'with exactly: NO_RESPONSE_NEEDED — and do not speak during hold music or hold announcements.',
      edges: [
        { id: 'e_listen_rep', condition: 'a live representative greets you or an automated eligibility response is reached', target: 'authenticate' },
        { id: 'e_listen_closed', condition: 'an after-hours message confirms the office is closed', target: 'closed' },
      ],
    },
    {
      id: 'authenticate',
      type: 'greeting',
      prompt:
        'Respond with a natural variation of: "Hi there, I\'m calling from {{provider_name}}. We\'re a healthcare provider and I need to ' +
        'verify insurance benefits for one of our patients. Our NPI is {{provider_npi}}. Could you help me with an eligibility and ' +
        'benefits check?" Cooperate if the representative needs to transfer you to the right department, and provide any additional ' +
        'authentication details requested.',
      edges: [],
    },
    { id: 'closed', type: 'greeting', prompt: 'Note that the office appears closed or unreachable right now.', edges: [] },
  ],
};

const INSURANCE_VERIFICATION_SINGLE_PROMPT = `## Role

You are **Alex**, an **Insurance Verification Specialist** calling on behalf of **{{provider_name}}**. You are an AI-powered voice agent built to call insurance payer lines, navigate IVR systems, authenticate as a calling provider, and collect patient benefit information efficiently and accurately.

### Role Boundaries
You are always the **caller** in this conversation. The person on the other end is an insurance company representative (or automated system). You are calling them for help — never offer to help them. Do not mirror phrases like "How can I help you?" back at the representative. When greeted or asked how they can assist, respond by stating your purpose: verifying benefits for a patient.

---

## Call Flow Overview

- Navigate the insurance company's IVR system to reach the eligibility and benefits department
- Authenticate as a calling provider using the NPI and practice details on file
- Verify the patient's eligibility and active coverage
- Collect benefit details: deductible, copay/coinsurance, out-of-pocket maximum, and prior authorization requirements
- Confirm and read back any authorization numbers or reference IDs using the NATO phonetic alphabet
- Log all verified benefit information via \`submit_verification\`

---

## Insurance Verification Workflow

> **Note:** Before this call, you have access to: patient first name, last name, date of birth, member ID, group number, insurance company name, provider name ({{provider_name}}), and provider NPI. Use this data throughout without asking the representative to repeat themselves.

### Step 1: IVR Navigation

When the call connects and an automated system answers, do not speak — listen to each prompt carefully.

Navigate toward:
- Eligibility and Benefits
- Provider Services
- Authorizations
- Claims (only if Eligibility and Benefits is unavailable)

Avoid:
- Member Services (patient-facing lines)
- Billing
- Medical Records
- Clinical departments

Speak menu options out loud when the IVR is speech-driven. Use a keypad press when the IVR is DTMF-driven.

If the IVR asks you to say your NPI, provide a natural variation of:

> "{{provider_npi}}"

Continue navigating until you reach a live representative or an automated eligibility response.

## Hold And Pause Handling

If you are told "hold on," "one moment," "please wait," or similar:

Respond with exactly:

> NO_RESPONSE_NEEDED

Do not speak during hold music or hold announcements.

### Step 2: Provider Authentication

Once a live representative greets you, respond with a natural variation of:

> "Hi there, I'm calling from {{provider_name}}. We're a healthcare provider and I need to verify insurance benefits for one of our patients. Our NPI is {{provider_npi}}. Could you help me with an eligibility and benefits check?"

<*Wait for representative response*>

If the representative needs to transfer you to the right department, cooperate and wait.

Provide any additional authentication details requested.

### Step 3: Patient Verification

When the representative asks for patient information, provide:

- Patient name: {{patient_first_name}} {{patient_last_name}}
- Date of birth: {{patient_dob}}
- Member ID: {{member_id}}
- Group number: {{group_number}}

If the representative reads back a member ID or any alphanumeric string, confirm it character by character using the NATO Phonetic Alphabet.

Call \`lookup_patient_record\` once the representative has confirmed the patient's identity.

### Step 4: Benefits Collection

Ask one question at a time — never combine.

#### Step 4.1: Confirm Eligibility

Respond exactly with:

> "Is the patient currently active and eligible as of today?"

<*Wait for representative response*>

#### Step 4.2: Collect Deductible

Respond exactly with:

> "What's the in-network deductible, and how much has been met?"

<*Wait for representative response*>

#### Step 4.3: Collect Out-Of-Pocket Maximum

Respond exactly with:

> "What's the out-of-pocket maximum, and how much has been met?"

<*Wait for representative response*>

#### Step 4.4: Collect Copay Or Coinsurance

Respond exactly with:

> "What's the copay or coinsurance for {{service_type}}?"

<*Wait for representative response*>

#### Step 4.5: Confirm Prior Authorization

Respond exactly with:

> "Is a prior authorization required for this service?"

<*Wait for representative response*>

#### Step 4.6: Collect Authorization Number (If Required)

If prior authorization is required, respond exactly with:

> "Can I get that authorization number?"

<*Wait for representative response*>

When the representative gives you an auth number or reference ID, read it back using the NATO Phonetic Alphabet to confirm accuracy.

Respond exactly with:

> "Just to confirm — that's [number]. Did I get that right?"

### Step 5: Summary Confirmation

Provide a natural variation of:

> "Just to confirm — {{patient_first_name}} {{patient_last_name}} is [active/inactive], in-network deductible is [amount] with [amount] met, out-of-pocket max is [amount] with [amount] met, [copay/coinsurance] applies to {{service_type}}, and prior auth [is / is not] required. Is that all correct?"

<*Wait for representative response*>

Then ask:

> "Can I get your name and a call reference number for my records?"

<*Wait for representative response*>

### Step 6: Log And End

Call \`submit_verification\` with all collected benefit details.

Respond exactly with:

> "Thanks so much — I appreciate your help. Have a good one."

Call \`end_call\`

---

## Failure Conditions

Call \`end_call\` if:
- An after-hours message confirms the office is closed`;

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
        // check_availability/book_appointment (real Cal.com booking, see
        // call-loop-poc's server.js) are automatically offered as tools
        // here whenever this tenant has a calendar connected — nothing in
        // this template controls that, it's a server-side gate. When
        // they're NOT available (no calendar connected), the flow still
        // works exactly as before, just extracting preferred_time as plain
        // text with no real availability check.
        prompt:
          "Ask for the caller's name, email, and preferred appointment day. If real calendar tools are available " +
          'to you, use check_availability before proposing any time, and book_appointment only after the caller ' +
          'confirms a specific slot from that real availability — never invent or guess a time.',
        extract: { name: 'string', email: 'string', preferred_time: 'string' },
        edges: [{ id: 'e_booking_done', condition: 'the appointment is booked or confirmed (booking_confirmed is set, or name/time were collected and confirmed the normal way)', target: 'goodbye' }],
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
        // Edge conditions reference the normalized `payment_status` field
        // (see call-loop-poc's /twilio/pay-result) directly, not vague
        // phrasing like "payment failed or was canceled" — a live test
        // reproduced the model treating an unrecognized raw Twilio Result
        // value as "try again" and re-triggering payment twice instead of
        // routing here, because the wording didn't match closely enough.
        prompt: 'Let the caller know you\'re securely transferring them to enter their card details now — they should follow the prompts they hear.',
        params: { amount: '0', paymentConnector: 'Default' },
        edges: [
          { id: 'e_payment_success', condition: 'payment_status is "succeeded"', target: 'confirm' },
          { id: 'e_payment_failed', condition: 'payment_status is "failed"', target: 'failed' },
        ],
      },
      { id: 'confirm', type: 'goodbye', prompt: "Confirm the payment was received, thank the caller, and say goodbye.", edges: [] },
      { id: 'failed', type: 'goodbye', prompt: "Let the caller know the payment didn't go through and they may want to try again or call back, then say goodbye.", edges: [] },
    ],
  },
  {
    // Rebuilt 2026-09-18 to match Retell's real template (screenshot
    // comparison): this is an OUTBOUND call — WE are the provider's agent
    // calling the INSURANCE COMPANY's payer line, not a patient calling us.
    // The previous version of this template had the role backwards
    // (inbound, patient-facing) — a real gap found doing this comparison,
    // not just a parity nice-to-have.
    id: 'insurance-verification-caller',
    label: 'Insurance Verification Caller',
    description: "Calls an insurance payer line as the provider's agent, navigates the IVR, authenticates, and collects benefit details.",
    category: 'Insurance Verification',
    startNodeId: 'ivr_navigation',
    singlePrompt: INSURANCE_VERIFICATION_SINGLE_PROMPT,
    nodes: [
      {
        id: 'ivr_navigation',
        type: 'subflow_ref',
        // See materializeTemplateSubflows — this seed becomes a real
        // agent-scoped subflow the first time this template is applied.
        params: { _templateSubflowSeed: JSON.stringify(IVR_NAVIGATION_SUBFLOW_SEED) },
        edges: [
          { id: 'e_ivr_reached_rep', condition: 'a live representative answered and you introduced yourself and your NPI', target: 'patient_verification' },
          { id: 'e_ivr_closed', condition: 'an after-hours message confirmed the office is closed, or you could not reach a representative', target: 'failure_close' },
        ],
      },
      {
        id: 'patient_verification',
        type: 'greeting',
        prompt:
          "Provide the following patient details as the representative needs them: patient name {{patient_first_name}} {{patient_last_name}}, " +
          "date of birth {{patient_dob}}, member ID {{member_id}}, group number {{group_number}}. If the representative reads back the member " +
          "ID or any alphanumeric string, confirm it character by character using the NATO phonetic alphabet. Wait for the representative to " +
          "confirm the patient's identity before moving on.",
        edges: [{ id: 'e_patient_confirmed', condition: 'the representative has confirmed the patient identity', target: 'lookup_patient_record' }],
      },
      {
        id: 'lookup_patient_record',
        // Same "real webhook, not a fake success" pattern as every other
        // function-node template — ships pointed at nothing until a tenant
        // wires a real EHR/PM system lookup here.
        type: 'function',
        function: 'lookup_patient_record',
        params: { webhookUrl: '' },
        edges: [{ id: 'e_lookup_done', condition: 'always', target: 'benefits_collection' }],
      },
      {
        id: 'benefits_collection',
        type: 'extraction',
        prompt:
          'Ask one question at a time, never combined: (1) "Is the patient currently active and eligible as of today?" (2) "What\'s the ' +
          'in-network deductible, and how much has been met?" (3) "What\'s the out-of-pocket maximum, and how much has been met?" (4) "What\'s ' +
          'the copay or coinsurance for {{service_type}}?" (5) "Is a prior authorization required for this service?" — and if so, "Can I get ' +
          'that authorization number?", reading any auth number or reference ID back using the NATO phonetic alphabet to confirm it.',
        extract: {
          eligible: 'string', deductible: 'string', deductible_met: 'string', oop_max: 'string', oop_max_met: 'string',
          copay_or_coinsurance: 'string', prior_auth_required: 'string', auth_number: 'string',
        },
        edges: [{
          id: 'e_benefits_done',
          condition: 'eligibility, deductible, out-of-pocket max, copay/coinsurance, and prior auth status have all been collected (and the auth number too, if one was required)',
          target: 'summary_confirmation',
        }],
      },
      {
        id: 'summary_confirmation',
        type: 'extraction',
        prompt:
          'Read back the full benefit summary to the representative for confirmation: eligibility status, deductible and amount met, ' +
          "out-of-pocket max and amount met, copay/coinsurance for {{service_type}}, and whether prior auth is required. Then ask for the " +
          "representative's name and a call reference number for your records.",
        extract: { rep_name: 'string', reference_number: 'string' },
        edges: [{ id: 'e_summary_done', condition: 'the representative confirmed the summary and provided their name and a reference number', target: 'submit_verification' }],
      },
      {
        id: 'submit_verification',
        type: 'function',
        function: 'submit_verification',
        params: { webhookUrl: '' },
        edges: [{ id: 'e_submit_done', condition: 'always', target: 'goodbye' }],
      },
      { id: 'goodbye', type: 'goodbye', prompt: 'Thank the representative for their help and say a brief goodbye.', edges: [] },
      {
        id: 'failure_close',
        type: 'greeting',
        prompt: "Acknowledge the after-hours message or that a representative couldn't be reached, without leaving a message unless clearly appropriate.",
        edges: [{ id: 'e_failure_end', condition: 'always', target: 'end_call_failure' }],
      },
      { id: 'end_call_failure', type: 'goodbye', prompt: 'Politely end the call — this verification attempt will need to be retried.', edges: [] },
    ],
  },
  {
    id: 'document-request-caller',
    label: 'Document Request Caller',
    description: 'Call to request a required document and text over an upload link, following up if needed.',
    category: 'Document Request',
    startNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        type: 'greeting',
        prompt: "Greet the caller and explain you're following up because a document is still needed to complete their file.",
        edges: [{ id: 'e_to_confirm', condition: 'always', target: 'confirm' }],
      },
      {
        id: 'confirm',
        type: 'extraction',
        prompt: 'Confirm which document is needed and that this is still the best number/caller to send the upload link to.',
        extract: { document_name: 'string' },
        edges: [{ id: 'e_confirm_done', condition: 'the document name has been confirmed', target: 'send_link' }],
      },
      {
        id: 'send_link',
        // Real SMS via call-loop-poc's own Twilio Messages API — not a
        // "pretend I texted you" line. {{document_name}} pulls in what was
        // just confirmed above.
        type: 'sms',
        prompt: "Let the caller know you're texting them the upload link now.",
        params: { body: 'Please upload your {{document_name}} using this link: [upload link goes here]' },
        edges: [{ id: 'e_link_sent', condition: 'always', target: 'goodbye' }],
      },
      { id: 'goodbye', type: 'goodbye', prompt: 'Confirm they received the text, thank them, and say goodbye.', edges: [] },
    ],
  },
];
