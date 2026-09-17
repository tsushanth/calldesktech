// Simulation "Run" — reuses the same synthetic-customer-with-a-goal design
// as call-loop-poc's mystery-shopper framework (a caller-persona LLM
// pursuing a real goal, not scripted turns), adapted two ways for this use
// case: the goal comes from the test case (not a single hardcoded scenario),
// and it converses over text via textFlowEngine rather than a real phone
// call — this exercises the agent's actual published flow (real webhook/KB
// nodes execute for real) without telephony cost or audio latency, letting
// a test run in seconds.
import { getAnthropicClient } from '@/lib/anthropic';
import { fetchKnowledgeItems } from '@/lib/chatFlowResolver';
import { runOpeningTurn, runUserTurn, type EngineFlow, type EngineState, type EngineMessage } from '@/lib/textFlowEngine';

const SHOPPER_MODEL = process.env.CHAT_LLM_MODEL || process.env.LLM_MODEL || 'claude-haiku-4-5-20251001';
const JUDGE_MODEL = 'claude-opus-5';
const MAX_TURNS = 8;
const END_SENTINEL = '[END_SIMULATION]';

export interface SimulationTurn {
  role: 'caller' | 'agent';
  content: string;
}

export interface SimulationResult {
  transcript: SimulationTurn[];
  passed: boolean;
  reasoning: string;
}

// One caller line, or END_SENTINEL if the goal is clearly reached (or the
// call has gone in circles long enough that continuing wouldn't teach us
// anything) — mirrors the real shopper's own judgment about when to close,
// just expressed as a token instead of voice-specific closing-phrase
// detection (that heuristic exists to handle real ASR artifacts, irrelevant
// over clean text).
async function nextCallerLine(goal: string, transcript: SimulationTurn[]): Promise<string> {
  const anthropic = getAnthropicClient();
  const history = transcript.map((t) => `${t.role === 'caller' ? 'You' : 'Business'}: ${t.content}`).join('\n');
  const message = await anthropic.messages.create({
    model: SHOPPER_MODEL,
    max_tokens: 200,
    system:
      'You are playing the role of a real customer calling a business, testing their AI receptionist. You are NOT ' +
      'an assistant in this conversation — you are the caller. Your goal: ' + goal + '. Speak naturally, one short ' +
      'message at a time, like a real phone caller — never break character, never mention this is a test. Answer ' +
      "the business's questions directly. Once your goal is clearly accomplished (or the conversation has " +
      `stalled with no progress for several turns), reply with exactly "${END_SENTINEL}" and nothing else.`,
    messages: [
      { role: 'user', content: history ? `Conversation so far:\n${history}\n\nWhat do you say next?` : 'The call just connected. What do you say first?' },
    ],
  });
  const block = message.content.find((b) => b.type === 'text');
  return block?.type === 'text' ? block.text.trim() : END_SENTINEL;
}

async function judgeTranscript(transcript: SimulationTurn[], successCriteria: string): Promise<{ passed: boolean; reasoning: string }> {
  const anthropic = getAnthropicClient();
  const transcriptText = transcript.map((t) => `${t.role === 'caller' ? 'Caller' : 'Agent'}: ${t.content}`).join('\n');
  const JUDGE_TOOL = {
    name: 'emit_verdict',
    description: 'Score whether this call transcript satisfies the success criteria.',
    input_schema: {
      type: 'object' as const,
      properties: {
        passed: { type: 'boolean', description: 'true only if the success criteria was genuinely met' },
        reasoning: { type: 'string', description: 'one or two sentences on why, citing specifics from the transcript' },
      },
      required: ['passed', 'reasoning'],
    },
  };
  const message = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 500,
    system: 'You judge whether a call transcript between a caller and an AI receptionist satisfies a specific success criterion. Be strict — only pass it if the transcript actually shows it happening, not just that it seems plausible.',
    messages: [{ role: 'user', content: `Success criteria: ${successCriteria}\n\nTranscript:\n${transcriptText}` }],
    tools: [JUDGE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_verdict' },
  });
  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { passed: false, reasoning: 'The judge model did not return a verdict.' };
  }
  const input = toolUse.input as { passed?: boolean; reasoning?: string };
  return { passed: !!input.passed, reasoning: input.reasoning || '' };
}

export async function runTestCaseSimulation(
  flow: EngineFlow,
  testCase: { userPrompt: string; successCriteria: string }
): Promise<SimulationResult> {
  const transcript: SimulationTurn[] = [];

  const opening = await runOpeningTurn(flow, { fetchKnowledgeItems });
  for (const msg of opening.assistantMessages) transcript.push({ role: 'agent', content: msg });
  let state: EngineState = opening.state;
  let ended = opening.ended;
  const history: EngineMessage[] = opening.assistantMessages.map((content) => ({ role: 'assistant', content }));

  let turns = 0;
  while (!ended && turns < MAX_TURNS) {
    turns++;
    const callerLine = await nextCallerLine(testCase.userPrompt, transcript);
    if (callerLine.includes(END_SENTINEL)) break;
    transcript.push({ role: 'caller', content: callerLine });
    history.push({ role: 'user', content: callerLine });

    const result = await runUserTurn(flow, state, history, callerLine, { fetchKnowledgeItems });
    for (const msg of result.assistantMessages) {
      transcript.push({ role: 'agent', content: msg });
      history.push({ role: 'assistant', content: msg });
    }
    state = result.state;
    ended = result.ended;
  }

  const verdict = await judgeTranscript(transcript, testCase.successCriteria);
  return { transcript, ...verdict };
}
