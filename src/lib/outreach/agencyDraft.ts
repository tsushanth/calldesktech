import { getAnthropicClient } from '@/lib/anthropic';
import { cliComplete, extractJson, usingCli } from './llm';
import { detectDraftLanguage } from './language';
import { calldesk, type ProductConfig } from './products';

// Drafts a short first-touch email to a voice-AI agency. Facts the model may
// state are limited to product.offerFacts (see products.ts); everything else
// (payout timing, duration, minimums, prices, benchmark results) is
// intentionally absent so it cannot be promised or invented. Update
// products.ts's offerFacts when terms are set.
//
// OFFER_FACTS/SYSTEM_PROMPT/SIGNATURE below are kept as calldesk-specific
// aliases into products.ts so any other existing caller/import of this
// module's old exports keeps working unchanged.
export const OFFER_FACTS = calldesk.offerFacts;

export interface AgencyDraftInput {
  name: string;
  domain?: string | null;
  tier?: string | null;
  location?: string | null;
  description?: string | null;
  dossier?: { summary: string; verticals: string[]; services: string[]; hook: string | null } | null;
  product?: ProductConfig;
}

export interface AgencyDraft {
  subject: string;
  body: string;
  // Literal English back-translation, present only when the draft itself was
  // written in a non-English target language — lets an admin who can't read
  // that language verify the content before approving it.
  translationSubject?: string;
  translationBody?: string;
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
    translationSubject: { type: 'string', description: 'Literal English translation of subject, for review only. Omit entirely if subject/body are already in English.' },
    translationBody: { type: 'string', description: 'Literal English translation of body, for review only. Omit entirely if subject/body are already in English.' },
  },
} as const;

export const SIGNATURE = calldesk.signature;

// Normalizes model output: strips any model-written sign-off, fixes question marks,
// and appends the one fixed signature so every email closes identically.
export function tidyBody(body: string, product: ProductConfig = calldesk): string {
  const lines = body.trim().split('\n');
  const signoff = /^(best|regards|kind regards|thanks|thank you|cheers|sincerely|warmly|best regards)[,.]?$|^sushanth\b.*$|^deepika\b.*$|^(co-?)?founders?\b.*$|^calldesk\s*$|^readaloudai\.org\s*$|^--+$/i;
  while (lines.length && (lines[lines.length - 1].trim() === '' || signoff.test(lines[lines.length - 1].trim()))) lines.pop();
  let b = lines.join('\n').trim();
  b = b.replace(/((?:Would|Could|Can|Are|Do|Is|Might)\b[^.?!\n]*)\.(\s*)$/gm, '$1?$2');
  return `${b}\n\n${product.signature}`;
}

export async function draftAgencyEmail(input: AgencyDraftInput): Promise<AgencyDraft> {
  const product = input.product ?? calldesk;
  const language = detectDraftLanguage(input.location ?? null);

  const userPrompt = [
    `Agency: ${input.name}${input.domain ? ` (${input.domain})` : ''}`,
    input.location ? `Location: ${input.location}` : '',
    language ? `Target language: ${language.name} — write the whole email in ${language.name}. This is an international lead, so it's worth naturally mentioning ${product.id === 'calldesk' ? `Calldesk supports ${language.name} (part of its 55 verified languages)` : `we can support ${language.name}`} if it fits.` : '',
    input.description ? `Their own description of what they do:\n"""\n${input.description}\n"""` : '',
    input.dossier
      ? `Verified facts from their own website (mention at most ONE, exactly as stated, no embellishment):\n- ${input.dossier.summary}${input.dossier.hook ? `\n- Specific detail: ${input.dossier.hook}` : ''}${input.dossier.verticals.length ? `\n- Verticals: ${input.dossier.verticals.join(', ')}` : ''}`
      : '',
    '',
    'Offer facts you may use (and nothing else):',
    ...product.offerFacts.map((f) => `- ${f}`),
  ]
    .filter((l) => l !== '')
    .join('\n');

  const systemPrompt = product.systemPrompt;

  if (usingCli()) {
    const text = cliComplete(
      `${systemPrompt}\n\n${userPrompt}\n\nReply with ONLY a JSON object {"subject": string, "body": string${language ? ', "translationSubject": string, "translationBody": string' : ''}}. No markdown fences, no commentary.`,
      { maxTurns: 2 },
    );
    const parsed = extractJson<AgencyDraft>(text, 'object');
    if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') throw new Error('Draft reply was not valid JSON');
    return {
      subject: parsed.subject.trim(),
      body: tidyBody(parsed.body, product),
      ...(typeof parsed.translationSubject === 'string' && typeof parsed.translationBody === 'string'
        ? { translationSubject: parsed.translationSubject.trim(), translationBody: parsed.translationBody.trim() }
        : {}),
    };
  }

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 800,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }
  if (!raw.trim()) throw new Error('Draft model returned no text content');
  const parsed = JSON.parse(raw) as AgencyDraft;
  return {
    subject: parsed.subject.trim(),
    body: tidyBody(parsed.body, product),
    ...(typeof parsed.translationSubject === 'string' && typeof parsed.translationBody === 'string'
      ? { translationSubject: parsed.translationSubject.trim(), translationBody: parsed.translationBody.trim() }
      : {}),
  };
}

// Follow-up: most people don't reply to a single cold email. A short, low-
// pressure bump referencing the earlier note (never repeating the full
// pitch) — same offer-facts discipline as the first touch. `step` counts
// from 2 (1 is the original); the tone gets shorter and lower-pressure each
// time, and step 3+ explicitly offers to stop.
export interface FollowUpInput extends AgencyDraftInput {
  previousSubject: string;
  step: number; // 2, 3, ...
  isFinal: boolean;
}

export function followUpSubject(previousSubject: string): string {
  return previousSubject.toLowerCase().startsWith('re:') ? previousSubject : `Re: ${previousSubject}`;
}

export async function draftFollowUpEmail(input: FollowUpInput): Promise<AgencyDraft> {
  const product = input.product ?? calldesk;
  const language = detectDraftLanguage(input.location ?? null);
  const userPrompt = [
    `Agency: ${input.name}${input.domain ? ` (${input.domain})` : ''}`,
    language ? `Target language: ${language.name} — write the whole follow-up in ${language.name}.` : '',
    input.dossier?.hook ? `A specific detail about them, usable at most once across all emails so far: ${input.dossier.hook}` : '',
    `This is follow-up #${input.step - 1} to our earlier email, subject "${input.previousSubject}", which got no reply.`,
    input.isFinal ? 'This is the final follow-up in this sequence — say so, and offer to close the loop if it\'s not a fit.' : '',
    '',
    'Offer facts you may reference (and nothing else):',
    ...product.offerFacts.map((f) => `- ${f}`),
  ]
    .filter((l) => l !== '')
    .join('\n');

  const text = cliComplete(
    `${product.followUpSystemPrompt}\n\n${userPrompt}\n\nReply with ONLY a JSON object {"subject": string, "body": string${language ? ', "translationSubject": string, "translationBody": string' : ''}}. subject should be "${followUpSubject(input.previousSubject)}" unless a small variation reads more natural. No markdown fences, no commentary.`,
    { maxTurns: 2 },
  );
  const parsed = extractJson<AgencyDraft>(text, 'object');
  if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') throw new Error('Follow-up draft reply was not valid JSON');
  return {
    subject: parsed.subject.trim(),
    body: tidyBody(parsed.body, product),
    ...(typeof parsed.translationSubject === 'string' && typeof parsed.translationBody === 'string'
      ? { translationSubject: parsed.translationSubject.trim(), translationBody: parsed.translationBody.trim() }
      : {}),
  };
}
