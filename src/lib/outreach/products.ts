// Product configuration for the outreach-discovery harness. Everything that
// used to be hardcoded to Calldesk (table names, offer facts, draft
// prompt/positioning, signature, scoring vocabulary, notify() fallback URL)
// now lives here per product, selected via the PRODUCT env var (default
// 'calldesk'). Adding a product means adding a config here plus (for
// discovery) new SourceSpec modules wired into pipeline.ts behind
// `product.id === '<new product>'` -- it must never change calldesk's
// behavior on the default/PRODUCT=calldesk path.

export interface ScoreVocabularyRule {
  // Matched against the lead's lowercased description.
  pattern: RegExp;
  delta: number;
  reason: string;
}

export interface ProductConfig {
  id: string;
  // Prefix for the four outreach tables, e.g. 'calldesk_outreach' ->
  // calldesk_outreach_leads/runs/messages/suppressions.
  tablePrefix: string;
  // Local state dir name under the user's home directory (STOP file,
  // last_run_at, runs.jsonl, lock), so each product's harness invocation
  // keeps its own run history/limits without colliding with another product.
  stateDirName: string;
  // Fallback base URL used by notify() when NEXT_PUBLIC_APP_URL isn't set.
  baseUrl: string;
  // Facts the drafting model is allowed to state -- see agencyDraft.ts.
  offerFacts: string[];
  // First-touch drafting system prompt (co-founders/product framing).
  systemPrompt: string;
  // Follow-up drafting system prompt.
  followUpSystemPrompt: string;
  // Appended to every outbound email body.
  signature: string;
  // Rule-based scoring vocabulary applied to a lead's description text, in
  // order, mirroring score.ts's original hardcoded calldesk rules.
  scoreVocabulary: ScoreVocabularyRule[];
}

const CALLDESK_OFFER_FACTS = [
  'Calldesk (calldesk.tech) is an AI voice-agent platform: inbound and outbound phone agents, knowledge base, call analytics.',
  'Calldesk supports 55 languages on live calls, verified end-to-end (speech recognition, the agent itself, voice, and turn-taking).',
  'We are looking for a small number of agency design partners to try it with their clients.',
  'Partners receive a 20% revenue share on usage from customers they refer.',
  'Partners get a free trial and direct access to the founders.',
  'Partner terms beyond the 20% share (duration, payout timing, minimums) are being finalized with the first partners.',
];

const CALLDESK_SYSTEM_PROMPT = `You write short, specific, honest first-touch emails from the co-founders of Calldesk (Sushanth and Deepika) to owners of AI voice-agent agencies.

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
- Any sentence that asks something must end with a question mark.
- If a target language is specified below, write the ENTIRE email (subject and body) fluently and naturally in that language — not a literal/stilted translation. The offer facts must still only state what's given, exactly as accurately in that language. If no target language is specified, write in English.
- If a target language is specified, ALSO return translationSubject and translationBody: a literal, plain English translation of the subject and body you wrote, for internal review only (not sent). If no target language is specified, omit both fields.`;

const CALLDESK_FOLLOWUP_SYSTEM_PROMPT = `You write short, low-pressure follow-up emails from the co-founders of Calldesk (Sushanth and Deepika), following up on a first email that got no reply.

Rules:
- This is a BRIEF bump, not a repeat of the pitch. 2-4 sentences total. Do not re-explain what Calldesk is in detail; one short clause is enough if any.
- State ONLY facts from the provided offer facts if you reference the offer at all. Never invent prices, numbers, customers, or claims.
- Do not guilt-trip, create false urgency, or use hype words/emojis/exclamation marks.
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.
- On the LAST allowed follow-up (see "This is the final follow-up" note if present), explicitly say this is the last check-in and offer to close the loop if it's not a fit.
- If a target language is specified below, write the ENTIRE follow-up (subject and body) in that language, naturally, matching the language the first email was sent in. If none is specified, write in English.
- If a target language is specified, ALSO return translationSubject and translationBody: a literal, plain English translation of the subject and body you wrote, for internal review only (not sent). If no target language is specified, omit both fields.`;

const CALLDESK_SIGNATURE = 'Sushanth & Deepika\nCo-founders, Calldesk';

// Original score.ts vocabulary, unchanged, in original order.
const CALLDESK_SCORE_VOCABULARY: ScoreVocabularyRule[] = [
  { pattern: /white.?label|reseller|resell/, delta: 20, reason: 'describes itself as a white-label reseller' },
  { pattern: /small business|smb|local business|receptionist|home services|dental|real estate|trades/, delta: 10, reason: 'targets SMB/local-business verticals' },
  { pattern: /inbound|outbound|voice agent|voice ai/, delta: 5, reason: 'explicitly does voice-AI work' },
  { pattern: /enterprise|call center|contact center/, delta: -5, reason: 'enterprise/call-center focus (harder to switch)' },
];

export const calldesk: ProductConfig = {
  id: 'calldesk',
  tablePrefix: 'calldesk_outreach',
  stateDirName: '.calldesk-outreach',
  baseUrl: 'https://calldesk.tech',
  offerFacts: CALLDESK_OFFER_FACTS,
  systemPrompt: CALLDESK_SYSTEM_PROMPT,
  followUpSystemPrompt: CALLDESK_FOLLOWUP_SYSTEM_PROMPT,
  signature: CALLDESK_SIGNATURE,
  scoreVocabulary: CALLDESK_SCORE_VOCABULARY,
};

// readaloudai.org: a realtime TTS/STT API. Only verifiably true claims below
// -- no invented customer counts, uptime, or exact latency/competitor-price
// numbers. Pricing ($0.10/min) and "realtime STT/TTS API access now
// available" are the known-true facts; the competitor-pricing claim is
// deliberately qualified ("significantly cheaper ... on a per-minute basis")
// rather than citing specific numbers we haven't verified.
const READALOUD_OFFER_FACTS = [
  'readaloudai.org is a realtime speech-to-text and text-to-speech API for developers building voice products.',
  'Realtime STT and TTS API access is available now.',
  'Pricing is $0.10/min, which is significantly cheaper than Deepgram, ElevenLabs, and Cartesia on a per-minute basis.',
  'We are looking for a small number of early integration partners to try the API with their product.',
  'Partners get direct access to the founders for integration support.',
  'Terms beyond pricing (volume discounts, SLAs) are being finalized with the first partners.',
];

const READALOUD_SYSTEM_PROMPT = `You write short, specific, honest first-touch emails from the co-founders of readaloudai.org (Sushanth and Deepika) to teams building realtime voice products (telephony/voice-agent platforms, voice agents, dubbing/localization, accessibility tools, IVR replacement, e-learning narration) who currently rely on a speech API like Deepgram, ElevenLabs, or Cartesia.

Rules:
- State ONLY facts from the provided offer facts. Never invent prices, numbers, customers, integrations, benchmark results, uptime, or latency claims.
- Never claim readaloudai.org is faster or higher-quality than any named competitor, and never disparage a competitor by name. You may note the per-minute price difference exactly as given in the offer facts.
- Personalize with one concrete detail from the company's own description, without flattery.
- One clear, low-friction ask: a 15-minute call, API docs, or a reply to try it.
- Do not promise terms that are not in the offer facts; if asked about terms, say they are being finalized with the first partners.
- No hype words, no emojis, no exclamation marks.
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.
- If a target language is specified below, write the ENTIRE email (subject and body) fluently and naturally in that language — not a literal/stilted translation. The offer facts must still only state what's given, exactly as accurately in that language. If no target language is specified, write in English.
- If a target language is specified, ALSO return translationSubject and translationBody: a literal, plain English translation of the subject and body you wrote, for internal review only (not sent). If no target language is specified, omit both fields.`;

const READALOUD_FOLLOWUP_SYSTEM_PROMPT = `You write short, low-pressure follow-up emails from the co-founders of readaloudai.org (Sushanth and Deepika), following up on a first email that got no reply.

Rules:
- This is a BRIEF bump, not a repeat of the pitch. 2-4 sentences total. Do not re-explain what readaloudai.org is in detail; one short clause is enough if any.
- State ONLY facts from the provided offer facts if you reference the offer at all. Never invent prices, numbers, customers, or claims.
- Do not guilt-trip, create false urgency, or use hype words/emojis/exclamation marks.
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.
- On the LAST allowed follow-up (see "This is the final follow-up" note if present), explicitly say this is the last check-in and offer to close the loop if it's not a fit.
- If a target language is specified below, write the ENTIRE follow-up (subject and body) in that language, naturally, matching the language the first email was sent in. If none is specified, write in English.
- If a target language is specified, ALSO return translationSubject and translationBody: a literal, plain English translation of the subject and body you wrote, for internal review only (not sent). If no target language is specified, omit both fields.`;

const READALOUD_SIGNATURE = 'Sushanth & Deepika\nCo-founders, readaloudai.org';

// Scoring vocabulary tuned for realtime STT/TTS builder signals (telephony
// platforms, voice agents, dubbing/localization, accessibility, IVR
// replacement, e-learning narration) and mentions of the competitors we're
// priced against, rather than calldesk's agency/reseller vocabulary.
const READALOUD_SCORE_VOCABULARY: ScoreVocabularyRule[] = [
  { pattern: /deepgram|elevenlabs|eleven labs|cartesia/, delta: 20, reason: 'mentions a competing STT/TTS provider (Deepgram/ElevenLabs/Cartesia)' },
  { pattern: /realtime|real-time|streaming/, delta: 10, reason: 'realtime/streaming voice product' },
  { pattern: /telephony|voice agent|ivr|phone agent|call center|contact center/, delta: 10, reason: 'telephony/voice-agent or IVR-replacement product' },
  { pattern: /dubbing|localization|localisation|e-?learning|narration|accessibility|screen reader/, delta: 8, reason: 'dubbing/localization, accessibility, or e-learning narration use case' },
  { pattern: /enterprise/, delta: -5, reason: 'enterprise focus (harder to switch)' },
];

export const readaloud: ProductConfig = {
  id: 'readaloud',
  tablePrefix: 'readaloud_outreach',
  stateDirName: '.readaloud-outreach',
  baseUrl: 'https://readaloudai.org',
  offerFacts: READALOUD_OFFER_FACTS,
  systemPrompt: READALOUD_SYSTEM_PROMPT,
  followUpSystemPrompt: READALOUD_FOLLOWUP_SYSTEM_PROMPT,
  signature: READALOUD_SIGNATURE,
  scoreVocabulary: READALOUD_SCORE_VOCABULARY,
};

const PRODUCTS: Record<string, ProductConfig> = { calldesk, readaloud };

// Resolves a product config from a PRODUCT env-style value, defaulting to
// calldesk (unset/unknown values fall back to calldesk, never throw) so the
// default path is always identical to pre-multi-product behavior.
export function resolveProduct(value: string | undefined | null): ProductConfig {
  if (!value) return calldesk;
  return PRODUCTS[value] ?? calldesk;
}

// Table name helpers, replacing the hardcoded `calldesk_outreach_*` literals.
export function leadsTable(product: ProductConfig): string {
  return `${product.tablePrefix}_leads`;
}
export function runsTable(product: ProductConfig): string {
  return `${product.tablePrefix}_runs`;
}
export function messagesTable(product: ProductConfig): string {
  return `${product.tablePrefix}_messages`;
}
export function suppressionsTable(product: ProductConfig): string {
  return `${product.tablePrefix}_suppressions`;
}
