import { getAnthropicClient } from '@/lib/anthropic';
import { cliComplete, extractJson, usingCli } from './llm';

// Drafts a short first-touch email to a voice-AI agency. Facts the model may
// state are limited to OFFER_FACTS below; everything else (payout timing,
// duration, minimums, prices, benchmark results) is intentionally absent so
// it cannot be promised or invented. Update OFFER_FACTS when terms are set.

export const OFFER_FACTS = [
  'Calldesk (calldesk.tech) is an AI voice-agent platform: inbound and outbound phone agents, knowledge base, call analytics.',
  'We are looking for a small number of agency design partners to try it with their clients.',
  'Partners receive a 20% revenue share on usage from customers they refer.',
  'Partners get a free trial and direct access to the founder.',
  'Partner terms beyond the 20% share (duration, payout timing, minimums) are being finalized with the first partners.',
];

export interface AgencyDraftInput {
  name: string;
  domain?: string | null;
  tier?: string | null;
  location?: string | null;
  description?: string | null;
}

export interface AgencyDraft {
  subject: string;
  body: string;
}

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: { type: 'string', description: 'Specific, non-spammy subject under 70 characters. No clickbait.' },
    body: {
      type: 'string',
      description:
        'Plain-text email body, 90-140 words, 2-3 short paragraphs, no greeting name guess (start with "Hi there," if no name is known), signed "Sushanth". No links, no footer.',
    },
  },
} as const;

const SYSTEM_PROMPT = `You write short, specific, honest first-touch emails from the founder of Calldesk to owners of AI voice-agent agencies.

Rules:
- State ONLY facts from the provided offer facts. Never invent prices, numbers, customers, integrations, benchmark results or quality claims.
- Never claim Calldesk is better, faster, or higher quality than any competitor. Never name or disparage Retell. You may say the agency builds voice agents.
- Do not mention that the agency is a Retell partner.
- Personalize with one concrete detail from the agency's own description, without flattery.
- One clear, low-friction ask: a 15-minute call or a reply to try it.
- Do not promise terms that are not in the offer facts; if asked about terms, say they are being finalized with the first partners.
- No hype words, no emojis, no exclamation marks.`;

export async function draftAgencyEmail(input: AgencyDraftInput): Promise<AgencyDraft> {

  const userPrompt = [
    `Agency: ${input.name}${input.domain ? ` (${input.domain})` : ''}`,
    input.location ? `Location: ${input.location}` : '',
    input.description ? `Their own description of what they do:\n"""\n${input.description}\n"""` : '',
    '',
    'Offer facts you may use (and nothing else):',
    ...OFFER_FACTS.map((f) => `- ${f}`),
  ]
    .filter((l) => l !== '')
    .join('\n');

  if (usingCli()) {
    const text = cliComplete(
      `${SYSTEM_PROMPT}\n\n${userPrompt}\n\nReply with ONLY a JSON object {"subject": string, "body": string}. No markdown fences, no commentary.`,
      { maxTurns: 2 },
    );
    const parsed = extractJson<AgencyDraft>(text, 'object');
    if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') throw new Error('Draft reply was not valid JSON');
    return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  }

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 800,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }
  if (!raw.trim()) throw new Error('Draft model returned no text content');
  const parsed = JSON.parse(raw) as AgencyDraft;
  return { subject: parsed.subject.trim(), body: parsed.body.trim() };
}
