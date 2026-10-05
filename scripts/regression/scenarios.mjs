// First wave of builder-to-call checks. Each scenario publishes ONE version with ONE distinctive setting, has the AI
// shopper call the dedicated test number, and asserts on what the engine logged. `assert(log, helpers)` returns a list
// of failure strings (empty = pass). A scenario with `knownIssue` is expected to FAIL today: it documents a gap, and the
// run reports "still failing (known)" or flags it as FIXED when it starts passing.
import { agentText, lines } from './lib.mjs';

const node = (id, type, prompt, extra = {}) => ({ id, type, prompt, edges: [], ...extra });
const single = (prompt, extra = {}) => ({ startNodeId: 'main', nodes: [node('main', 'greeting', prompt, extra.node)], globalSettings: extra.globalSettings || {} });
const KEEP_IT_SHORT = ' Keep every reply to one short sentence. When your question is answered, say thanks and goodbye.';

/** @type {Array<Record<string, any>>} */
export const SCENARIOS = [
  {
    id: 'handbook-secret',
    title: 'Agent Handbook text is available to the agent',
    version: single('You are the receptionist for Zephyr Plumbing. Answer questions briefly and politely.', { globalSettings: { handbook: 'Our current promo code is ZEBRA-42. Tell callers about it if they ask for a discount or promo code.' } }),
    persona: 'You are a caller who wants to know if the company has a promo code or discount. Ask once.' + KEEP_IT_SHORT,
    assert: (log) => (/zebra[\s-]?42/i.test(agentText(log)) ? [] : ['the agent never said the promo code from the handbook (ZEBRA-42)']),
  },
  {
    id: 'exact-greeting',
    title: 'Exact words to say are spoken verbatim',
    version: { startNodeId: 'main', nodes: [node('main', 'greeting', 'Help the caller politely.', { params: { spokenMessage: 'Welcome to Quillbert Hardware, this call is recorded for quality.' } })], globalSettings: {} },
    persona: 'You are a caller who just wants store opening hours.' + KEEP_IT_SHORT,
    assert: (log) => {
      const first = lines(log).find((l) => l.speaker === 'agent')?.text || '';
      return /quillbert hardware/i.test(first) && /recorded for quality/i.test(first) ? [] : [`first agent line was not the configured greeting: "${first.slice(0, 120)}"`];
    },
  },
  {
    id: 'variables',
    title: 'Custom variables are filled into the prompt',
    version: single('You are the receptionist for {{business_name}}. If asked who you are, say the business name.', { globalSettings: { variables: { business_name: 'Zephyr Dental' } } }),
    persona: 'You are a caller who asks "Who am I speaking with?" and nothing else.' + KEEP_IT_SHORT,
    assert: (log) => {
      const t = agentText(log); const f = [];
      if (!/zephyr dental/i.test(t)) f.push('the agent never said the business name from the variable (Zephyr Dental)');
      if (/\{\{/.test(t)) f.push('a literal {{variable}} was spoken');
      return f;
    },
  },
  {
    id: 'single-prompt-hours',
    title: 'A single-prompt agent follows its prompt',
    version: single('You are the receptionist for Maple Cafe. The cafe is open 7am to 3pm every day. Answer only questions about opening hours and say so.'),
    persona: 'You are a caller who asks what time the cafe closes.' + KEEP_IT_SHORT,
    assert: (log) => (/\b(3|three)\s?(pm|p\.m\.|o'clock)?/i.test(agentText(log)) ? [] : ['the agent did not say the closing time (3pm)']),
  },
  {
    id: 'max-duration',
    title: 'Max call duration ends the call',
    version: single('You are a chatty receptionist for Birch Bakery. Always ask one more friendly question about what the caller likes to bake.', { globalSettings: { maxCallDurationSec: 25 } }),
    persona: 'You are a caller who loves talking about baking. Keep answering with an interesting detail and never say goodbye.',
    // 25s limit: it must run past 15s (not fail instantly) and be cut off well before a chatty call would end on its own.
    assert: (log) => (log.duration_seconds != null && log.duration_seconds >= 15 && log.duration_seconds <= 50 ? [] : [`the call lasted ${log.duration_seconds}s; expected it to be cut off near 25s`]),
  },
  {
    id: 'extraction-flow',
    title: 'A three-step flow collects fields and reaches goodbye',
    version: {
      startNodeId: 'greeting',
      nodes: [
        { id: 'greeting', type: 'greeting', prompt: 'Greet the caller as the Cedar Salon receptionist and ask if they want to book.', edges: [{ id: 'e1', target: 'collect', condition: 'caller wants to book an appointment' }] },
        { id: 'collect', type: 'extraction', prompt: 'Collect the caller name and the service they want.', extract: { name: { description: 'caller name' }, service: { description: 'service wanted' } }, edges: [{ id: 'e2', target: 'goodbye', condition: 'both name and service have been collected' }] },
        { id: 'goodbye', type: 'goodbye', prompt: 'Thank the caller, repeat their name and service, and say goodbye.', edges: [] },
      ],
      globalSettings: {},
    },
    persona: 'You are Priya. You want to book a haircut. When asked, give your name (Priya) and the service (haircut).' + KEEP_IT_SHORT,
    assert: (log) => {
      const t = agentText(log); const f = [];
      if (!/priya/i.test(t)) f.push('the goodbye did not repeat the caller name (Priya)');
      if (!/haircut/i.test(t)) f.push('the goodbye did not repeat the service (haircut)');
      return f;
    },
  },
];

const SPANISH_RE = /\b(hola|gracias|ayuda|puedo|puede|cómo|como puedo|buenos|buenas|por favor|qué|usted|cafe|café|con gusto|claro)\b/i;

SCENARIOS.push(
  {
    id: 'silence-checkin',
    title: 'Check in after silence prompts a silent caller',
    version: { startNodeId: 'main', nodes: [node('main', 'greeting', 'You are the receptionist for Alder Clinic. Greet the caller and ask how you can help.', { params: { reminderMessageFrequencySec: 5 } })], globalSettings: { endCallAfterSilenceSec: 24 } },
    persona: 'You are a caller who never says a single word. Stay completely silent for the entire call, even if asked a question.',
    assert: (log) => {
      // The reminder fires 5s after the greeting with nothing from the caller in between, so the first two real lines are both the agent.
      const real = lines(log).filter((l) => !/^\[/.test(l.text));
      return real[0]?.speaker === 'agent' && real[1]?.speaker === 'agent' && /still there|are you there|still on the line|hello/i.test(real[1].text) ? [] : ['the agent did not check in with a "still there?" line right after the greeting'];
    },
  },
  {
    id: 'language-switch',
    title: 'Mid-call language switching follows a Spanish-speaking caller',
    version: single('You are the receptionist for Sol Cafe. Answer briefly and reply in the language the caller is speaking.', { globalSettings: { allowLanguageSwitching: true, switchableLanguages: ['es'] } }),
    persona: 'Eres una persona que llama a una cafetería. Hablas solo en español. Pregunta a qué hora cierran y despídete.',
    shopperLanguage: 'es',
    assert: (log) => {
      const agent = lines(log).filter((l) => l.speaker === 'agent');
      const later = agent.slice(1).map((l) => l.text).join(' ');
      return SPANISH_RE.test(later) ? [] : ['no agent reply after the first turn was in Spanish'];
    },
  },
  {
    id: 'language-es-agent',
    title: 'An agent set to Spanish hears and answers a Spanish-speaking caller',
    version: single('Eres la recepcionista de Sol Cafe. Responde brevemente.', { globalSettings: { language: 'es' } }),
    persona: 'Eres una persona que llama a una cafetería. Hablas solo en español. Pregunta a qué hora cierran y despídete.',
    shopperLanguage: 'es',
    assert: (log) => {
      const t = lines(log).filter((l) => l.speaker === 'agent').map((l) => l.text).join(' ');
      return SPANISH_RE.test(t) && lines(log).some((l) => l.speaker === 'caller' && !/^\[/.test(l.text)) ? [] : ['the agent did not hear a Spanish caller or did not answer in Spanish'];
    },
  },
  {
    id: 'agent-transfer',
    title: 'Hand the call to another agent continues the call as that agent',
    prepare: async ({ publish, fx }) => {
      await publish({ agentId: fx.agentBId, name: 'reg-agent-b', version: single('You are Agent B at Larch Insurance. Say "Agent B here, Larch Insurance." then ask how you can help with the policy.') });
      return {
        startNodeId: 'greeting',
        nodes: [
          node('greeting', 'greeting', 'You are the front desk at Larch Insurance. Greet the caller briefly. If they ask about their policy or billing, hand them over.', { edges: [{ id: 'e1', target: 'handoff', condition: 'caller asks about their policy or billing' }] }),
          node('handoff', 'agent_transfer', 'Hand over to the policy specialist.', { params: { targetAgentId: fx.agentBId } }),
        ],
        globalSettings: {},
      };
    },
    version: { startNodeId: 'x', nodes: [], globalSettings: {} },
    persona: 'You are a caller with a question about your insurance policy billing. Say so right away.' + KEEP_IT_SHORT,
    assert: (log) => (/agent b here/i.test(agentText(log)) ? [] : ['the call never continued as Agent B ("Agent B here, Larch Insurance.")']),
  },
);

SCENARIOS.push({
  id: 'transfer-to-number',
  title: 'A transfer node dials the target number and the call arrives there',
  needsAllLogs: true,
  prepare: async ({ publish, route, fx }) => {
    const b = fx.extra.REGRESSION_NUMBER_B;
    if (!b) throw new Error('REGRESSION_NUMBER_B is not set in .env');
    // The target answers with a distinctive line, so its own call log proves the transfer arrived.
    const targetVersion = await publish({ agentId: fx.agentBId, name: 'reg-transfer-target', version: { startNodeId: 'main', nodes: [node('main', 'greeting', 'Say hello and ask how you can help.', { params: { spokenMessage: 'Transfer target reached for the regression suite.' } })], globalSettings: {} } });
    await route(b.id, targetVersion, 'inbound');
    return {
      startNodeId: 'greeting',
      nodes: [
        node('greeting', 'greeting', 'You are the front desk at Willow Realty. Greet the caller briefly. If they ask for sales or to speak to a person, transfer them.', { edges: [{ id: 'e1', target: 'xfer', condition: 'caller asks to be transferred, or to speak to sales or a person' }] }),
        node('xfer', 'transfer', 'Tell the caller you are connecting them to sales.', { params: { transferTo: b.number } }),
      ],
      globalSettings: {},
    };
  },
  version: { startNodeId: 'x', nodes: [], globalSettings: {} },
  persona: 'You are a caller who wants to speak to sales. Ask to be transferred to sales right away. Once connected to someone, say hello and then goodbye.',
  assert: (log, { logs }) => {
    const f = [];
    const reached = (logs || []).some((l) => /transfer target reached/i.test(agentText(l)));
    if (!reached) f.push('no call reached the transfer target number (no log with "Transfer target reached")');
    if (!/connect|transfer|sales/i.test(agentText(log))) f.push('the first agent never announced the transfer');
    return f;
  },
});

const toolFlow = (toolNode, reportPrompt) => ({
  startNodeId: 'greeting',
  nodes: [
    node('greeting', 'greeting', 'You are the front desk at Birch Appliance Repair. Greet the caller briefly. When they ask about appointment times or an order, look it up.', { edges: [{ id: 'e1', target: toolNode.id, condition: 'caller asks about available times or about an order' }] }),
    { ...toolNode, edges: [{ id: 'e2', target: 'report', condition: 'the lookup has finished' }] },
    node('report', 'greeting', reportPrompt, { edges: [] }),
  ],
});

SCENARIOS.push(
  {
    id: 'webhook-function',
    // Filler words are played as audio and do not appear in the stored transcript, so they cannot be checked here.
    title: 'A function node posts {function, collectedData} to its webhook and the agent uses the reply',
    needsReceiver: true,
    prepare: async ({ receiver }) => ({
      ...toolFlow({ id: 'check', type: 'function', function: 'check_availability', prompt: 'Check availability.', params: { webhookUrl: receiver.url('hook') } },
        'Tell the caller the available times from the system note (read them out), then say goodbye.'),
      globalSettings: {},
    }),
    version: { startNodeId: 'x', nodes: [], globalSettings: {} },
    persona: 'You are a caller who asks what appointment times are available this week. Wait for the answer, say thanks and goodbye.' + KEEP_IT_SHORT,
    assert: (log, { events }) => {
      const f = []; const t = agentText(log);
      const hook = (events || []).find((e) => e.kind === 'hook');
      if (!hook) f.push('the webhook never received a request from the engine');
      else {
        let body = {}; try { body = JSON.parse(hook.body); } catch { /* checked below */ }
        if (body.function !== 'check_availability') f.push(`the webhook body did not carry the function name (got ${JSON.stringify(body).slice(0, 80)})`);
      }
      // The webhook returns 10am and 2pm; the agent may say "10 AM", "10 in the morning" or "ten o'clock".
      if (!/\b(10|ten)\b/i.test(t) || !/\b(2|two)\b/i.test(t)) f.push('the agent did not read out the times returned by the webhook (10am and 2pm)');
      return f;
    },
  },
  {
    id: 'mcp-tool',
    title: 'An MCP node calls the tool with its header and arguments and the agent uses the result',
    needsReceiver: true,
    prepare: async ({ receiver }) => toolFlow(
      { id: 'lookup', type: 'mcp', prompt: 'Look up the order.', params: { serverUrl: receiver.url('mcp'), toolName: 'lookup_order', toolArguments: '{"id":"A-77"}', headers: '{"Authorization":"Bearer regression-token"}' } },
      'Tell the caller the order status and the expected arrival day from the system note, then say goodbye.'),
    version: { startNodeId: 'x', nodes: [], globalSettings: {} },
    persona: 'You are a caller who asks where your order is. Wait for the answer, say thanks and goodbye.' + KEEP_IT_SHORT,
    assert: (log, { events }) => {
      const f = []; const t = agentText(log);
      const calls = (events || []).filter((e) => e.kind === 'mcp').map((e) => { try { return JSON.parse(e.body); } catch { return {}; } });
      const methods = calls.map((c) => c.method);
      for (const m of ['initialize', 'notifications/initialized', 'tools/call']) if (!methods.includes(m)) f.push(`the MCP server never received ${m}`);
      const toolCall = calls.find((c) => c.method === 'tools/call');
      if (toolCall && (toolCall.params?.name !== 'lookup_order' || toolCall.params?.arguments?.id !== 'A-77')) f.push(`tools/call carried the wrong tool or arguments (${JSON.stringify(toolCall.params).slice(0, 100)})`);
      if (!(events || []).some((e) => e.kind === 'mcp' && /bearer regression-token/i.test(e.headers?.authorization || ''))) f.push('the configured Authorization header did not reach the MCP server');
      if (!/tuesday/i.test(t)) f.push('the agent did not tell the caller the arrival day from the tool result (Tuesday)');
      return f;
    },
  },
);

// Outbound scenarios: the tenant's number calls the receiver number, whose Twilio webhook plays a scripted callee
// (a phone menu that collects keypad digits, a voicemail greeting, or a silent line). They test what the engine does
// with a callee that is not a person, which an AI shopper cannot stand in for.
SCENARIOS.push(
  {
    id: 'dtmf-ivr',
    title: 'A press-digit node sends keypad tones that a phone menu receives',
    outbound: { mode: 'ivr' },
    needsReceiver: true,
    // Start directly on the press-digit node so the keypad step does not depend on the model choosing an edge.
    version: {
      startNodeId: 'press',
      nodes: [
        node('press', 'press_digit', 'Enter the extension.', { params: { digits: 'w214' }, edges: [{ id: 'e1', target: 'done', condition: 'the digits were sent' }] }),
        node('done', 'goodbye', 'Say that you entered the extension and say goodbye.', { edges: [] }),
      ],
      globalSettings: {},
    },
    assert: (log, { events }) => {
      const f = [];
      if (!(events || []).some((e) => e.kind === 'twiml')) f.push('the call never reached the receiver number');
      const dtmf = (events || []).find((e) => e.kind === 'dtmf');
      let digits = ''; try { digits = String(JSON.parse(dtmf?.body || '{}').digits || ''); } catch { /* handled below */ }
      if (!dtmf) f.push('the phone menu never received any keypad digits');
      else if (digits !== '214') f.push(`the menu received digits "${digits}" instead of 214`);
      return f;
    },
  },
  {
    id: 'voicemail-hangup',
    title: 'Voicemail detection in hang-up mode ends a call that reaches a voicemail greeting',
    outbound: { mode: 'voicemail' },
    needsReceiver: true,
    version: single('You are calling to confirm an appointment for Alder Clinic. Greet whoever answers and ask for the patient.', { globalSettings: { voicemailDetection: 'hangup' } }),
    assert: (log, { events }) => {
      const f = [];
      if (!(events || []).some((e) => e.kind === 'twiml')) f.push('the call never reached the receiver number');
      if (log.outcome !== 'voicemail') f.push(`the call outcome was "${log.outcome}", expected "voicemail"`);
      if (!(log.duration_seconds <= 40)) f.push(`the call lasted ${log.duration_seconds}s; expected a quick hang-up on the voicemail greeting`);
      return f;
    },
  },
  {
    id: 'voicemail-message',
    title: 'Voicemail detection in leave-message mode speaks the configured message',
    outbound: { mode: 'voicemail' },
    needsReceiver: true,
    version: single('You are calling to confirm an appointment for Acme Dental.', { globalSettings: { voicemailDetection: 'leave_message', voicemailMessage: 'Hi, this is Acme Dental calling about your appointment tomorrow. Please call us back.' } }),
    assert: (log) => {
      const f = [];
      if (log.outcome !== 'voicemail') f.push(`the call outcome was "${log.outcome}", expected "voicemail"`);
      if (!/acme dental calling about your appointment/i.test(agentText(log))) f.push('the configured voicemail message was not spoken');
      return f;
    },
  },
  {
    id: 'silence-hangup',
    title: 'End call after silence hangs up on a callee who says nothing',
    outbound: { mode: 'silent' },
    needsReceiver: true,
    version: single('You are calling from Alder Clinic. Say hello and ask if this is a good time to talk.', { globalSettings: { endCallAfterSilenceSec: 8 } }),
    assert: (log, { events }) => {
      const f = [];
      if (!(events || []).some((e) => e.kind === 'twiml')) f.push('the call never reached the receiver number');
      const d = log.duration_seconds;
      if (!(d >= 8 && d <= 40)) f.push(`the call lasted ${d}s; expected a hang-up roughly 8s after the greeting`);
      return f;
    },
  },
);

// Booking intent with no calendar: the regression tenant has no calendar connection, so the engine adds its "you do not have a
// calendar" guard and withholds check_availability/book_appointment. The agent must take the request, not pretend to book.
const BOOKED_CLAIM = /\bis booked\b|\byou(?:'re| are) booked\b|\bconfirmed your appointment\b|\ball set for\b/i;
const OUTRIGHT_REFUSAL = /\b(can(?:not|'t)|unable to|not able to)\s+(book|schedule|make an appointment)\b/i;
const fieldCollected = (log, keyRe, valueRe) => {
  // extracted_data shape is not pinned down, so accept either a matching key with a value or the agent echoing the value back.
  const ed = log.extracted_data && typeof log.extracted_data === 'object' ? log.extracted_data : {};
  const inData = Object.entries(ed).some(([k, v]) => keyRe.test(k) && v != null && String(v).trim() !== '');
  return inData || valueRe.test(agentText(log));
};

SCENARIOS.push({
  id: 'booking-no-calendar',
  title: 'A booking flow with no calendar takes the request and never claims it booked',
  version: {
    startNodeId: 'greeting',
    nodes: [
      node('greeting', 'greeting', 'You are the receptionist for Cedar Dental. If the caller wants an appointment, say you will take their details.', { edges: [{ id: 'e1', target: 'collect', condition: 'caller wants to book an appointment' }] }),
      node('collect', 'extraction', 'Ask for the caller name, the day and time they would prefer as a request, and a callback number. One question at a time. You cannot see a calendar: tell the caller the office will call back to confirm the time.', { extract: { name: 'string', preferred_time: 'string', callback_number: 'string' }, edges: [{ id: 'e2', target: 'goodbye', condition: 'name, preferred_time and callback_number have all been collected' }] }),
      node('goodbye', 'goodbye', 'Repeat the request back, say the office will call to confirm, and say goodbye.'),
    ],
    globalSettings: {},
  },
  persona: 'You are Dana Whitfield. You want to book a teeth cleaning. When asked, give your name (Dana Whitfield), preferred time (next Thursday afternoon) and callback number (555 0142).' + KEEP_IT_SHORT,
  assert: (log) => {
    const f = []; const t = agentText(log);
    const name = fieldCollected(log, /name/i, /dana/i);
    const when = fieldCollected(log, /time|day|date|prefer/i, /thursday/i);
    const phone = fieldCollected(log, /phone|number|callback/i, /555|0142|five five five/i);
    if (!name) f.push('the caller name was not collected');
    if (!when) f.push('the preferred day/time was not collected');
    if (!phone) f.push('the callback number was not collected');
    if (BOOKED_CLAIM.test(t)) f.push('the agent said the appointment is booked or confirmed, but it has no calendar');
    if (OUTRIGHT_REFUSAL.test(t) && !(name || when || phone)) f.push('the agent only refused ("cannot book") and collected no details');
    return f;
  },
});

export function pick(ids) {
  // Skipped scenarios run only when asked for by id.
  if (!ids || !ids.length) return SCENARIOS.filter((s) => !s.skip);
  const out = ids.map((id) => SCENARIOS.find((s) => s.id === id)).filter(Boolean);
  const unknown = ids.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknown.length) throw new Error(`unknown scenario(s): ${unknown.join(', ')}. Known: ${SCENARIOS.map((s) => s.id).join(', ')}`);
  return out;
}
