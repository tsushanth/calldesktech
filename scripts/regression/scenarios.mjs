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
    id: 'silence-hangup',
    title: 'End call after silence hangs up on a silent caller',
    skip: 'needs a scripted silent caller (TwiML <Pause>); the AI shopper cannot stay silent, it says "Silence." out loud',
    version: single('You are the receptionist for Alder Clinic. Greet the caller and ask how you can help.', { globalSettings: { endCallAfterSilenceSec: 8 } }),
    persona: 'You are a caller who never says a single word. Stay completely silent for the entire call, even if asked a question.',
    assert: (log) => {
      const f = []; const d = log.duration_seconds;
      if (lines(log).some((l) => l.speaker === 'caller' && !/^\[/.test(l.text))) f.push('the shopper spoke, so silence was not tested');
      if (!(d >= 8 && d <= 40)) f.push(`the call lasted ${d}s; expected a hang-up roughly 8s after the greeting`);
      return f;
    },
  },
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
    knownIssue: 'while the agent is configured for English, a Spanish caller is not transcribed at all (the agent heard nothing for the whole call), so the switch never triggers. Control: language-es-agent passes with the same caller.',
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

export function pick(ids) {
  // Skipped scenarios run only when asked for by id.
  if (!ids || !ids.length) return SCENARIOS.filter((s) => !s.skip);
  const out = ids.map((id) => SCENARIOS.find((s) => s.id === id)).filter(Boolean);
  const unknown = ids.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknown.length) throw new Error(`unknown scenario(s): ${unknown.join(', ')}. Known: ${SCENARIOS.map((s) => s.id).join(', ')}`);
  return out;
}
