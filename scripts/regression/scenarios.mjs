// First wave of builder-to-call checks. Each scenario publishes ONE version with ONE distinctive setting, has the AI
// shopper call the dedicated test number, and asserts on what the engine logged. `assert(log, helpers)` returns a list
// of failure strings (empty = pass). A scenario with `knownIssue` is expected to FAIL today: it documents a gap, and the
// run reports "still failing (known)" or flags it as FIXED when it starts passing.
import { agentText, lines } from './lib.mjs';

const node = (id, type, prompt, extra = {}) => ({ id, type, prompt, edges: [], ...extra });
const single = (prompt, extra = {}) => ({ startNodeId: 'main', nodes: [node('main', 'greeting', prompt, extra.node)], globalSettings: extra.globalSettings || {} });
const KEEP_IT_SHORT = ' Keep every reply to one short sentence. When your question is answered, say thanks and goodbye.';

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

export function pick(ids) {
  if (!ids || !ids.length) return SCENARIOS;
  const out = ids.map((id) => SCENARIOS.find((s) => s.id === id)).filter(Boolean);
  const unknown = ids.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknown.length) throw new Error(`unknown scenario(s): ${unknown.join(', ')}. Known: ${SCENARIOS.map((s) => s.id).join(', ')}`);
  return out;
}
