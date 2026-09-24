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
  // Set only for products whose four tables are SHARED with other writers via
  // a `product` column (calldesk_outreach_* is shared with the separate
  // Kreative Koala harness, which inserts rows with product values like
  // 'kreativekoala:voxkey'). When set, every query against this product's
  // tables must filter/tag rows by this value, or it will silently read and
  // write another product's rows -- confirmed 2026-09-23: calldesk's own
  // drafting stage was starved because its pending-draft count included all
  // of Kreative Koala's pending drafts from the same physical table. A
  // product with its own dedicated tables (no shared `product` column, e.g.
  // readaloud_outreach_*) leaves this unset.
  sharedTableProductValue?: string;
  // Set only for customer-DISCOVERY products (see VERTICAL_DEFS below): short,
  // non-sales research asks to small businesses in one vertical. When set:
  //   * agencyDraft.ts labels the lead as a `leadLabel` (not an "Agency") and
  //     presents the description as public-record/listing facts, not "their own words"
  //   * the agency-specific research stage is skipped (it judges "is this an AI
  //     voice agency"; irrelevant here) and drafting does not require a dossier
  //   * follow-ups default to `defaultMaxFollowUps` (env OUTREACH_MAX_FOLLOWUPS still wins)
  // Left undefined for calldesk/readaloud so their behavior is unchanged.
  vertical?: { leadLabel: string; leadPlural: string; defaultMaxFollowUps: number };
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
  sharedTableProductValue: 'calldesk',
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

// ---------------------------------------------------------------------------
// Customer-discovery verticals. Same Calldesk brand and the SAME shared
// calldesk_outreach_* tables as calldesk (scoped via the `product` column, like
// Kreative Koala), so no migration. These are research asks, not sales pitches
// and not the agency-partner offer.
// ---------------------------------------------------------------------------

interface VerticalDef {
  id: 'freight' | 'homeservices' | 'dental' | 'insurance';
  leadLabel: string; // singular, used in the draft prompt ("Freight brokerage: <name>")
  leadPlural: string; // e.g. "freight brokerages"
  topic: string; // what we are researching, in prose
  askAbout: string; // short form for subject/follow-up
  registryFact: string; // what the lead data can support about the recipient
  scoreVocabulary: ScoreVocabularyRule[];
}

const VERTICAL_SIGNATURE = 'Sushanth & Deepika\nCo-founders, Calldesk';

function verticalOfferFacts(v: VerticalDef): string[] {
  return [
    'Calldesk (calldesk.tech) is an AI voice-agent platform: inbound and outbound phone agents.',
    `We are in early customer research on how small ${v.leadPlural} handle ${v.topic}.`,
    'We are not selling anything in this email and are not asking them to sign up for or buy anything.',
    'We have not built anything specific for this industry yet; we want to understand the day-to-day work first.',
    'We are asking for a 15-minute conversation (a call, or a reply by email) to hear how they handle this today.',
    'We can share a short summary of what we learn from these conversations with the people who take part.',
  ];
}

function verticalSystemPrompt(v: VerticalDef): string {
  return `You write short, honest customer-discovery emails from the co-founders of Calldesk (Sushanth and Deepika) to owners and operators of small ${v.leadPlural}. This is research outreach. It is NOT a sales pitch and NOT a partnership offer.

Rules:
- State ONLY facts from the provided offer facts and lead data. About the recipient you may say only what the lead data supports: the business name, its location, and ${v.registryFact}. Never invent customers, results, integrations, statistics, or claims about their operations, volume, staff, tools, or problems. Do not assume they have any problem; ask how they handle things.
- No fake familiarity: no "loved your post", "I saw you recently", "I noticed your team is growing". No flattery.
- Content, in this order: (1) one sentence saying who we are, the co-founders of Calldesk, an AI voice-agent platform; (2) that we are researching how small ${v.leadPlural} handle ${v.topic}, and that we are not selling anything; (3) one clear ask: 15 minutes of their time to hear how they handle it today; (4) that we are happy to share what we learn.
- No pricing, discounts, free trials, revenue share, or partner terms. No urgency, scarcity, or "quick question" tricks. No hype words, no emojis, no exclamation marks.
- Never claim Calldesk is better, faster, or cheaper than any product or competitor.
- Subject: plain and specific, under 70 characters, e.g. about ${v.askAbout}. Not clickbait, not "Re:" or "Fwd:".
- Body: 60-110 words, 2-3 short paragraphs. Start with "Hi there,".
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.
- Write in English.`;
}

function verticalFollowUpPrompt(v: VerticalDef): string {
  return `You write short, low-pressure follow-up emails from the co-founders of Calldesk (Sushanth and Deepika), following up on a customer-discovery email to a small business (${v.leadPlural}) that got no reply. It is research outreach, not a sales pitch.

Rules:
- This is a BRIEF bump: 2-3 sentences. Restate only that we are researching how small ${v.leadPlural} handle ${v.topic}, that we are not selling anything, and that 15 minutes would help.
- State ONLY facts from the provided offer facts. Never invent customers, results, or claims about the recipient. No pricing, no partner terms.
- Do not guilt-trip, create false urgency, or use hype words, emojis, or exclamation marks.
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.
- On the LAST allowed follow-up (see "This is the final follow-up" note if present), say this is the last note and that we will not follow up again.
- Write in English.`;
}

// Words that signal a small, owner-run business (up) versus a chain, franchise
// or national enterprise (down). Matched against the lowercased lead
// description (legal/dba name and listing blurb).
const SMALL_UP: ScoreVocabularyRule = { pattern: /family[- ]owned|locally owned|owner[- ]operated|independent(ly)?|boutique|since (19|20)\d\d|small (business|team|practice|agency)/, delta: 10, reason: 'describes itself as small, independent, or owner-run' };
const CHAIN_DOWN: ScoreVocabularyRule = { pattern: /franchise|nationwide|national (network|brand|company)|corporate|enterprise|holdings|publicly traded|\b\d{2,}\+? (offices|locations|branches|clinics|practices)|locations (across|in \d+)|multi-?state/, delta: -15, reason: 'chain, franchise, or national/enterprise signals' };

const VERTICAL_DEFS: VerticalDef[] = [
  {
    id: 'freight',
    leadLabel: 'Freight brokerage',
    leadPlural: 'freight brokerages',
    topic: 'carrier check calls, load coverage, and the phone follow-up around moving each load',
    askAbout: 'how small freight brokerages handle carrier check calls',
    registryFact: 'that it is listed in the public FMCSA registry with active property broker authority',
    scoreVocabulary: [
      { pattern: /\b(brokerage|3pl|logistics|freight)\b/, delta: 5, reason: 'name reads like a freight brokerage' },
      { pattern: /family[- ]owned|independent|owner[- ]operated|boutique/, delta: 10, reason: 'describes itself as small, independent, or owner-run' },
      { pattern: /worldwide|global|international|nationwide|national|corporation|holdings|\bgroup\b/, delta: -8, reason: 'name suggests a larger or enterprise-scale operation' },
    ],
  },
  {
    id: 'homeservices',
    leadLabel: 'Home services company',
    leadPlural: 'HVAC, plumbing, electrical, and roofing companies',
    topic: 'missed calls, after-hours calls, and booking service appointments',
    askAbout: 'how small home-service companies handle missed calls and booking',
    registryFact: 'that it is a local HVAC, plumbing, electrical, or roofing business (from its own website)',
    scoreVocabulary: [
      { pattern: /hvac|heating|air conditioning|plumb|electric|roofing|contractor/, delta: 5, reason: 'trade matches HVAC/plumbing/electrical/roofing' },
      { pattern: /24\/?7|emergency|same[- ]day|service calls?/, delta: 5, reason: 'runs emergency/same-day service (phone-driven demand)' },
      SMALL_UP, CHAIN_DOWN,
    ],
  },
  {
    id: 'dental',
    leadLabel: 'Dental practice',
    leadPlural: 'independent dental practices',
    topic: 'patient phone calls, new-patient booking, and appointment reschedules',
    askAbout: 'how small dental practices handle patient calls and reschedules',
    registryFact: 'that it is an independent dental practice (from its own website)',
    scoreVocabulary: [
      { pattern: /dental|dentist|orthodont|periodont|endodont|oral surgery/, delta: 5, reason: 'dental practice' },
      { pattern: /general dentistry|family dentistry|new patients?|emergency dental/, delta: 5, reason: 'general practice taking new patients (phone-driven demand)' },
      SMALL_UP,
      { pattern: /dso|dental support|aspen dental|heartland dental|pacific dental|smile brands|western dental|coast dental|affordable dentures|corporate/, delta: -20, reason: 'DSO or corporate dental group' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'insurance',
    leadLabel: 'Insurance agency',
    leadPlural: 'independent insurance agencies',
    topic: 'quote requests, policy-service calls, and after-hours calls',
    askAbout: 'how small independent insurance agencies handle quote and service calls',
    registryFact: 'that it is an independent insurance agency (from its own website)',
    scoreVocabulary: [
      { pattern: /independent (insurance )?agen|insurance agency|insurance broker|insurance services/, delta: 5, reason: 'independent insurance agency' },
      { pattern: /personal lines|commercial lines|auto|home|life|benefits|quotes?/, delta: 3, reason: 'sells lines that generate quote and service calls' },
      SMALL_UP,
      { pattern: /state farm|allstate|farmers|geico|progressive|liberty mutual|nationwide|american family|captive|carrier[- ]owned/, delta: -20, reason: 'captive/carrier-owned or national carrier agent' },
      CHAIN_DOWN,
    ],
  },
];

function verticalProduct(v: VerticalDef): ProductConfig {
  return {
    id: v.id,
    tablePrefix: 'calldesk_outreach',
    stateDirName: `.calldesk-${v.id}-outreach`,
    baseUrl: 'https://calldesk.tech',
    sharedTableProductValue: `calldesk:${v.id}`,
    offerFacts: verticalOfferFacts(v),
    systemPrompt: verticalSystemPrompt(v),
    followUpSystemPrompt: verticalFollowUpPrompt(v),
    signature: VERTICAL_SIGNATURE,
    scoreVocabulary: v.scoreVocabulary,
    vertical: { leadLabel: v.leadLabel, leadPlural: v.leadPlural, defaultMaxFollowUps: 1 },
  };
}

export const freight = verticalProduct(VERTICAL_DEFS[0]);
export const homeservices = verticalProduct(VERTICAL_DEFS[1]);
export const dental = verticalProduct(VERTICAL_DEFS[2]);
export const insurance = verticalProduct(VERTICAL_DEFS[3]);
export const VERTICAL_PRODUCT_IDS = ['freight', 'homeservices', 'dental', 'insurance'] as const;

const PRODUCTS: Record<string, ProductConfig> = { calldesk, readaloud, freight, homeservices, dental, insurance };

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

// Scopes a select/update query builder to this product's rows when its
// tables are shared with another writer (see ProductConfig.sharedTableProductValue).
// A no-op for a product with its own dedicated tables.
// Typed `any` in/out (matching this file's `Db = SupabaseClient<any>` convention)
// -- a generic constrained to Supabase's actual filter-builder type blows up
// the compiler ("Type instantiation is excessively deep and possibly
// infinite"), confirmed against the real build 2026-09-23.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeToProduct(query: any, product: ProductConfig): any {
  return product.sharedTableProductValue ? query.eq('product', product.sharedTableProductValue) : query;
}

// The fields to spread into an insert payload so a new row is correctly
// tagged for this product when its tables are shared. `{}` for a product
// with its own dedicated tables (no `product` column exists to set).
export function productInsertFields(product: ProductConfig): { product?: string } {
  return product.sharedTableProductValue ? { product: product.sharedTableProductValue } : {};
}
