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
  'Partners get a free trial and direct access to the founders.',
  'Partner terms beyond the 20% share (duration, payout timing, minimums) are being finalized with the first partners.',
];

export interface AgencyDraftInput {
  name: string;
  domain?: string | null;
  tier?: string | null;
  location?: string | null;
  description?: string | null;
  dossier?: { summary: string; verticals: string[]; services: string[]; hook: string | null } | null;
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
        'Plain-text email body, 90-140 words, 2-3 short paragraphs, no greeting name guess (start with "Hi there," if no name is known). No sign-off or signature, no links, no footer.',
    },
  },
} as const;

const SYSTEM_PROMPT = `You write short, specific, honest first-touch emails from the co-founders of Calldesk (Sushanth and Deepika) to owners of AI voice-agent agencies.

Rules:
- State ONLY facts from the provided offer facts. Never invent prices, numbers, customers, integrations, benchmark results or quality claims.
- Never claim Calldesk is better, faster, or higher quality than any competitor. Never name or disparage Retell. You may say the agency builds voice agents.
- Do not mention that the agency is a Retell partner.
- Personalize with one concrete detail from the agency's own description, without flattery.
- One clear, low-friction ask: a 15-minute call or a reply to try it.
- Do not promise terms that are not in the offer facts; if asked about terms, say they are being finalized with the first partners.
- No hype words, no emojis, no exclamation marks.
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.`;

export const SIGNATURE = 'Sushanth & Deepika\nCo-founders, Calldesk';

// Normalizes model output: strips any model-written sign-off, fixes question marks,
// and appends the one fixed signature so every email closes identically.
export function tidyBody(body: string): string {
  const lines = body.trim().split('\n');
  const signoff = /^(best|regards|kind regards|thanks|thank you|cheers|sincerely|warmly|best regards)[,.]?$|^sushanth\b.*$|^deepika\b.*$|^(co-?)?founders?\b.*$|^calldesk\s*$|^--+$/i;
  while (lines.length && (lines[lines.length - 1].trim() === '' || signoff.test(lines[lines.length - 1].trim()))) lines.pop();
  let b = lines.join('\n').trim();
  b = b.replace(/((?:Would|Could|Can|Are|Do|Is|Might)\b[^.?!\n]*)\.(\s*)$/gm, '$1?$2');
  return `${b}\n\n${SIGNATURE}`;
}

export async function draftAgencyEmail(input: AgencyDraftInput): Promise<AgencyDraft> {

  const userPrompt = [
    `Agency: ${input.name}${input.domain ? ` (${input.domain})` : ''}`,
    input.location ? `Location: ${input.location}` : '',
    input.description ? `Their own description of what they do:\n"""\n${input.description}\n"""` : '',
    input.dossier
      ? `Verified facts from their own website (mention at most ONE, exactly as stated, no embellishment):\n- ${input.dossier.summary}${input.dossier.hook ? `\n- Specific detail: ${input.dossier.hook}` : ''}${input.dossier.verticals.length ? `\n- Verticals: ${input.dossier.verticals.join(', ')}` : ''}`
      : '',
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
    return { subject: parsed.subject.trim(), body: tidyBody(parsed.body) };
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
  return { subject: parsed.subject.trim(), body: tidyBody(parsed.body) };
}

// Follow-up: most people don't reply to a single cold email. A short, low-
// pressure bump referencing the earlier note (never repeating the full
// pitch) — same offer-facts discipline as the first touch. `step` counts
// from 2 (1 is the original); the tone gets shorter and lower-pressure each
// time, and step 3+ explicitly offers to stop.
const FOLLOWUP_SYSTEM_PROMPT = `You write short, low-pressure follow-up emails from the co-founders of Calldesk (Sushanth and Deepika), following up on a first email that got no reply.

Rules:
- This is a BRIEF bump, not a repeat of the pitch. 2-4 sentences total. Do not re-explain what Calldesk is in detail; one short clause is enough if any.
- State ONLY facts from the provided offer facts if you reference the offer at all. Never invent prices, numbers, customers, or claims.
- Do not guilt-trip, create false urgency, or use hype words/emojis/exclamation marks.
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.
- On the LAST allowed follow-up (see "This is the final follow-up" note if present), explicitly say this is the last check-in and offer to close the loop if it's not a fit.`;

export interface FollowUpInput extends AgencyDraftInput {
  previousSubject: string;
  step: number; // 2, 3, ...
  isFinal: boolean;
}

export function followUpSubject(previousSubject: string): string {
  return previousSubject.toLowerCase().startsWith('re:') ? previousSubject : `Re: ${previousSubject}`;
}

export async function draftFollowUpEmail(input: FollowUpInput): Promise<AgencyDraft> {
  const userPrompt = [
    `Agency: ${input.name}${input.domain ? ` (${input.domain})` : ''}`,
    input.dossier?.hook ? `A specific detail about them, usable at most once across all emails so far: ${input.dossier.hook}` : '',
    `This is follow-up #${input.step - 1} to our earlier email, subject "${input.previousSubject}", which got no reply.`,
    input.isFinal ? 'This is the final follow-up in this sequence — say so, and offer to close the loop if it\'s not a fit.' : '',
    '',
    'Offer facts you may reference (and nothing else):',
    ...OFFER_FACTS.map((f) => `- ${f}`),
  ]
    .filter((l) => l !== '')
    .join('\n');

  const text = cliComplete(
    `${FOLLOWUP_SYSTEM_PROMPT}\n\n${userPrompt}\n\nReply with ONLY a JSON object {"subject": string, "body": string}. subject should be "${followUpSubject(input.previousSubject)}" unless a small variation reads more natural. No markdown fences, no commentary.`,
    { maxTurns: 2 },
  );
  const parsed = extractJson<AgencyDraft>(text, 'object');
  if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') throw new Error('Follow-up draft reply was not valid JSON');
  return { subject: parsed.subject.trim(), body: tidyBody(parsed.body) };
}
