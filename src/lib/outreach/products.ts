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
  // product with its own dedicated tables (no shared `product` column)
  // leaves this unset.
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
  // Added with the bulk sources (readaloud/import.ts), whose descriptions are
  // one-liners and plugin summaries: a speech product said in plain words.
  { pattern: /text[- ]to[- ]speech|speech[- ]to[- ]text|speech recognition|\btts\b|\basr\b|voice ai|read aloud/, delta: 5, reason: 'speech synthesis/recognition product' },
  { pattern: /enterprise/, delta: -5, reason: 'enterprise focus (harder to switch)' },
];

export const readaloud: ProductConfig = {
  id: 'readaloud',
  // Shares the calldesk_outreach_* tables (tagged product='readaloud') so its drafts show up in the
  // same admin queue and go through the same capped, paced sender. It used to have its own
  // readaloud_outreach_* tables (migration 042); those are now unused and left in place.
  tablePrefix: 'calldesk_outreach',
  sharedTableProductValue: 'readaloud',
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
// Kreative Koala), so no migration. These are help-first pilot offers (a free,
// capped trial of a Calldesk phone agent on their overflow calls) that also
// serve as customer discovery. Not the agency-partner offer.
// ---------------------------------------------------------------------------

interface VerticalDef {
  id:
    | 'freight' | 'homeservices' | 'dental' | 'insurance' | 'towing' | 'septic' | 'homecare' | 'bailbonds'
    // batch 3: eight more verticals, same offer and same shared tables.
    | 'childcare' | 'accounting' | 'realestate' | 'lodging' | 'funeral' | 'physio' | 'taxi' | 'vets';
  leadLabel: string; // singular, used in the draft prompt ("Freight brokerage: <name>")
  leadPlural: string; // e.g. "freight brokerages"
  topic: string; // what we are researching, in prose
  askAbout: string; // short form for subject/follow-up
  situation: string; // when calls get missed, in prose, phrased as a question topic
  agentHandles: string; // what the pilot agent does on their calls, using only what Calldesk does today
  subjectHint: string; // example subject, plain and specific
  registryFact: string; // what the lead data can support about the recipient
  // Extra hard rules appended to the draft/follow-up prompts (vertical-specific compliance framing).
  extraRules?: string[];
  scoreVocabulary: ScoreVocabularyRule[];
}

const VERTICAL_SIGNATURE = 'Sushanth & Deepika\nCo-founders, Calldesk';

const PILOT_TERMS = 'free for two weeks, capped at 50 minutes of calls, no credit card, and they can stop any time';

function verticalOfferFacts(v: VerticalDef): string[] {
  return [
    'Calldesk (calldesk.tech) is an AI voice-agent platform: inbound and outbound phone agents.',
    `We want to help small ${v.leadPlural} with ${v.topic}.`,
    `The offer: we set up a Calldesk phone agent for them, on a number they forward their overflow or after-hours calls to. It ${v.agentHandles}, and every call gets a summary and transcript they can review.`,
    `The pilot is ${PILOT_TERMS}. We do the setup ourselves; they only need to forward calls.`,
    'To accept, they reply "yes" and tell us which number they would forward calls from. If it is not useful, we ask them to tell us what would be, which helps us just as much.',
    'We have not built anything specific for this industry; the agent is a general Calldesk phone agent configured for their calls. Do not claim integrations with their software, booking systems, or CRM.',
  ];
}

function extra(v: VerticalDef): string {
  return (v.extraRules ?? []).map((r) => `\n- ${r}`).join('');
}

// The vertical prompts used to end with a flat "Write in English." while
// agencyDraft.ts was already adding "Target language: X — write the whole email
// in X" for a non-English location (language.detectDraftLanguage), so the two
// instructions contradicted each other and the model had to pick one. The rule
// is now conditional, matching the calldesk/readaloud prompts: English by
// default, the target language when the lead data names one, and in that case
// an English back-translation for the admin who reviews the draft.
//
// `kind` is "email" or "follow-up" so the wording names what is being written.
const LANGUAGE_RULES = (kind: string) =>
  `- Write in English UNLESS a "Target language" is given in the lead data below. If one is given, write the ENTIRE ${kind} (subject and body) fluently and naturally in that language — not a literal or stilted translation.
- The pilot terms, and every other offer fact, must mean exactly the same in that language as in English: nothing added, dropped, softened, or made to sound more generous.
- If a target language is given, ALSO return translationSubject and translationBody: a literal, plain English translation of the subject and body you wrote, for internal review only (it is never sent). If no target language is given, omit both fields.`;

function verticalSystemPrompt(v: VerticalDef): string {
  return `You write short, honest, help-first cold emails from the co-founders of Calldesk (Sushanth and Deepika) to owners and operators of small ${v.leadPlural}. The goal is to offer something concretely useful: a free, capped pilot of a phone agent that catches calls they would otherwise miss. It is not a generic sales pitch, and not a partnership offer.

Rules:
- State ONLY facts from the provided offer facts and lead data. About the recipient you may say only what the lead data supports: the business name, its location, and ${v.registryFact}. Never invent customers, results, integrations, statistics, or claims about their operations, volume, staff, tools, or problems. Do not assert they have a problem; ask about ${v.situation} as a question.
- No fake familiarity: no "loved your post", "I saw you recently", "I noticed your team is growing". No flattery.
- Content, in this order: (1) one sentence: we are the co-founders of Calldesk, and we build AI phone agents, plus at most one supported fact about them; (2) one question about what happens to calls when ${v.situation}; (3) the offer: we will set up a Calldesk phone agent for them to try on those calls, and say briefly what it does (from the offer facts), with the pilot terms exactly as given; (4) the one-line reply: reply "yes" with the number they would forward calls from, or tell us what would make it useful.
- Never mention a recording, audio, attachment, link, or "below": any sample call is added below the email automatically, and not every email has one.
- The only pricing statement allowed is the pilot terms from the offer facts. No other prices, discounts, revenue share, partner terms, or urgency/scarcity tricks. No hype words, no emojis, no exclamation marks.
- Never claim Calldesk is better, faster, or cheaper than any product or competitor. Do not say it "never misses a call", or promise results.
- Subject: plain and specific, under 70 characters, in the spirit of "${v.subjectHint}". Not clickbait, not "Re:" or "Fwd:".
- Body: 70-120 words, 3 short paragraphs. Start with "Hi there,".${extra(v)}
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.
${LANGUAGE_RULES('email')}`;
}

function verticalFollowUpPrompt(v: VerticalDef): string {
  return `You write short, low-pressure follow-up emails from the co-founders of Calldesk (Sushanth and Deepika), following up on an earlier offer to a small business (${v.leadPlural}) that got no reply. The earlier email offered a free, capped pilot of a phone agent for their overflow calls.

Rules:
- This is a BRIEF bump: 2-3 sentences. Restate that we can set up a Calldesk phone agent for them to try on ${v.situation}, using the pilot terms exactly as in the offer facts, and that a one-word "yes" plus the number they would forward from is all we need.
- State ONLY facts from the provided offer facts. Never invent customers, results, or claims about the recipient. No other pricing or partner terms.
- Never mention a recording, audio, attachment, link, or "below".
- Do not guilt-trip, create false urgency, or use hype words, emojis, or exclamation marks.
- Write in the first person plural ("we", "us", "our"). Never use "I", "me" or "my", and never introduce yourselves by name or title.
- Do NOT write a sign-off or signature; one is added automatically.
- Any sentence that asks something must end with a question mark.
- On the LAST allowed follow-up (see "This is the final follow-up" note if present), say this is the last note and that we will not follow up again.${extra(v)}
${LANGUAGE_RULES('follow-up')}`;
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
    situation: 'carrier calls come in while everyone is busy on other loads or after hours',
    agentHandles: "answers carrier check calls and load inquiries, collects the carrier's MC number, the load in question, and a callback number",
    subjectHint: 'Help with carrier calls when nobody is free to pick up',
    registryFact: 'that it is listed in a public transport registry, worded exactly as the lead data words it (for example "listed in the public FMCSA registry with active property broker authority", or "listed in the Traffic Commissioners for Great Britain goods vehicle operator licence register as a licensed goods vehicle operator")',
    scoreVocabulary: [
      { pattern: /\b(brokerage|3pl|logistics|freight)\b/, delta: 5, reason: 'name reads like a freight brokerage' },
      { pattern: /family[- ]owned|independent|owner[- ]operated|boutique/, delta: 10, reason: 'describes itself as small, independent, or owner-run' },
      { pattern: /insur|assurance|surance|underwrit/, delta: -30, reason: 'name suggests an insurance business, not a freight brokerage' },
      { pattern: /worldwide|global|international|nationwide|national|corporation|holdings|\bgroup\b/, delta: -8, reason: 'name suggests a larger or enterprise-scale operation' },
    ],
  },
  {
    id: 'homeservices',
    leadLabel: 'Home services company',
    leadPlural: 'HVAC, plumbing, electrical, and roofing companies',
    topic: 'missed calls, after-hours calls, and booking service appointments',
    askAbout: 'how small home-service companies handle missed calls and booking',
    situation: 'the crew is out on a job, or a no-heat or other emergency call comes in after hours',
    agentHandles: "answers the call, finds out what is wrong, and collects the caller's name, address, and callback number",
    subjectHint: 'Catching after-hours service calls',
    registryFact: 'either that it is a local HVAC, plumbing, electrical, or roofing business (from its own website), or, when the lead data words it that way, that it is listed in a public contractor registry, licence file, or roster, worded exactly as the lead data words it (for example "listed in the Washington State Department of Labor & Industries registry as a registered plumbing contractor", or "listed in the Virginia Department of Professional and Occupational Regulation contractor licence file as a licensed HVAC contractor") — whichever the lead data supports, never both',
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
    situation: 'the front desk is busy or the office is closed and a patient calls',
    agentHandles: "answers, takes new-patient and reschedule requests, and collects the caller's name and callback number",
    subjectHint: 'Help with patient calls when the front desk is busy',
    registryFact: 'either that it is an independent dental practice (from its own website), or, when the lead data words it that way, that it is listed in a public healthcare provider registry or government dataset, worded exactly as the lead data words it (for example "listed in the CMS National Plan and Provider Enumeration System (NPPES) NPI registry as a dental practice with an organisational NPI") — whichever the lead data supports, never both',
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
    situation: 'a quote request or policy-service call comes in when nobody can answer',
    agentHandles: 'answers, finds out what the caller needs, and collects their name, policy or quote details they offer, and a callback number',
    subjectHint: 'Catching quote and service calls after hours',
    registryFact: 'either that it is an independent insurance agency (from its own website), or, when the lead data words it that way, that it is listed in a state insurance licensee file or other government dataset, worded exactly as the lead data words it (for example "listed in the Florida Department of Financial Services licensee file as a licensed insurance agency") — whichever the lead data supports, never both',
    scoreVocabulary: [
      { pattern: /independent (insurance )?agen|insurance agency|insurance broker|insurance services/, delta: 5, reason: 'independent insurance agency' },
      { pattern: /personal lines|commercial lines|auto|home|life|benefits|quotes?/, delta: 3, reason: 'sells lines that generate quote and service calls' },
      SMALL_UP,
      { pattern: /state farm|allstate|farmers|geico|progressive|liberty mutual|nationwide|american family|captive|carrier[- ]owned/, delta: -20, reason: 'captive/carrier-owned or national carrier agent' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'towing',
    leadLabel: 'Towing company',
    leadPlural: 'independent towing companies',
    topic: 'dispatch and after-hours tow requests, including calls that come in while the crew is out on a job',
    askAbout: 'how small towing companies handle dispatch and after-hours calls',
    situation: 'a tow request comes in while the crew is out on a job or after hours',
    agentHandles: "answers, collects the caller's location, vehicle, and callback number",
    subjectHint: 'Catching after-hours tow requests',
    registryFact: 'that it is listed in a public licensing registry or government dataset, worded exactly as the lead data words it (for example "listed in the Washington State Department of Licensing registry as a registered tow truck operator")',
    scoreVocabulary: [
      { pattern: /24\/?7|24[- ]hour|round[- ]the[- ]clock|emergency|heavy[- ]duty|flatbed/, delta: 5, reason: 'name suggests 24-hour or emergency towing (phone-driven demand)' },
      SMALL_UP, CHAIN_DOWN,
    ],
  },
  {
    id: 'septic',
    leadLabel: 'Septic service company',
    leadPlural: 'independent septic service companies',
    topic: 'scheduling and dispatch, and call overflow during the busy season',
    askAbout: 'how small septic companies handle scheduling and busy-season calls',
    situation: 'busy-season call volume backs up and calls go to voicemail',
    agentHandles: 'answers, finds out what the caller needs, and collects their name, address, and callback number',
    subjectHint: 'Help with busy-season septic calls',
    registryFact: 'that it is listed in a public licensing registry or government dataset, worded exactly as the lead data words it (for example "listed in the Florida Department of Health registry as a master septic tank contractor")',
    scoreVocabulary: [
      { pattern: /pump(ing)?|emergency|24\/?7|24[- ]hour/, delta: 3, reason: 'name suggests pumping/emergency service (phone-driven demand)' },
      SMALL_UP, CHAIN_DOWN,
    ],
  },
  {
    id: 'homecare',
    leadLabel: 'Home care agency',
    leadPlural: 'independent home care agencies',
    topic: 'new-client inquiry calls and weekend follow-up with families',
    askAbout: 'how small home care agencies handle new-client inquiries and weekend calls',
    situation: 'a family calls to ask about care and nobody is free, especially on weekends',
    agentHandles: "answers, collects the family's name, what they are looking for, and a callback number",
    subjectHint: 'Catching new-client inquiry calls on weekends',
    registryFact: 'that it is listed in a public health-department registry, dataset, or licensed facility file, worded exactly as the lead data words it (for example "listed in the Illinois Department of Public Health registry as a licensed home health agency", or "listed in the California Department of Public Health licensed facility file as a home health agency")',
    scoreVocabulary: [SMALL_UP, CHAIN_DOWN],
  },
  {
    id: 'bailbonds',
    leadLabel: 'Bail bonds agency',
    leadPlural: 'independent bail bonds agencies',
    topic: 'after-hours intake calls and returning missed calls',
    askAbout: 'how small bail bonds agencies handle after-hours intake calls',
    situation: 'an intake call comes in after hours',
    agentHandles: "answers and collects only the caller's name and a callback number, and gives no legal advice",
    subjectHint: 'Help with after-hours intake calls',
    registryFact: 'either that it is a local bail bonds business (from its own website), or, when the lead data words it that way, that it is listed in a state licensee file, worded exactly as the lead data words it (for example "listed in the Florida Department of Financial Services licensee file as a licensed bail bond agency") — whichever the lead data supports, never both',
    extraRules: [
      'Do not give or imply legal advice, and do not comment on arrests, charges, jail, courts, or anyone\'s legal situation. Ask only about how the business handles its phone intake outside office hours.',
    ],
    scoreVocabulary: [
      { pattern: /bail\s*bond/, delta: 5, reason: 'bail bonds agency' },
      { pattern: /24\/?7|24[- ]hour|around the clock|day or night/, delta: 5, reason: 'advertises 24-hour service (phone-driven demand)' },
      SMALL_UP,
      { pattern: /bad boys|nationwide|national|network of/, delta: -10, reason: 'national brand or network signals' },
      CHAIN_DOWN,
    ],
  },

  // ---- batch 3 -------------------------------------------------------------
  // Same offer, same shared tables, same help-first structure. Each one's
  // extraRules carry the compliance framing that vertical needs: the agent only
  // ever takes a name, a callback number and what the caller is asking about,
  // so no vertical may have it advise, quote, confirm, or triage anything.
  {
    id: 'childcare',
    leadLabel: 'Child care centre',
    leadPlural: 'child care centres, daycares, nurseries and preschools',
    topic: 'parent enquiry calls and tour requests that come in while staff are with the children',
    askAbout: 'how small child care centres handle parent enquiry and tour calls',
    situation: 'every member of staff is with the children and a parent calls to ask about a place or a tour',
    agentHandles:
      "answers, finds out the age of the child and the days of care the parent is asking about, and collects the parent's name and a callback number",
    subjectHint: 'Help with parent calls while staff are with the children',
    registryFact:
      'that it is listed in a public child care licensing dataset or registry, worded exactly as the lead data words it (for example "listed in the Texas Health and Human Services licensing data as a licensed child care operation", or "listed in the Washington State Department of Children, Youth & Families licensing data as a licensed child care center")',
    extraRules: [
      'Never refer to, ask about, or speculate about individual children, families, staffing ratios, inspections, licensing compliance, capacity, or enrolment numbers. The only subject is what happens to incoming phone calls.',
      'Never state or imply that a place is available, or that the agent would offer, hold, or confirm a place, a tour, or a waitlist position. It takes details and a person follows up.',
    ],
    scoreVocabulary: [
      { pattern: /child ?care|day ?care|nursery|preschool|pre-?k\b|early (learning|childhood|education)|montessori|learning cent(er|re)|academy/, delta: 5, reason: 'child care centre, daycare, nursery or preschool' },
      SMALL_UP,
      {
        pattern: /kindercare|bright horizons|goddard|primrose school|la petite academy|childtime|tutor time|learning care group|right at school|kids ?r ?kids|sunshine house|cr[eè]me de la cr[eè]me|lightbridge|celebree|guidepost montessori|new horizon academy|children'?s lighthouse|cadence education|endeavor schools|the learning experience|\bnobel learning\b/,
        delta: -25,
        reason: 'national child care chain or franchise brand',
      },
      { pattern: /\bymca\b|\bywca\b|boys (and|&) girls club|head start|school district|\bisd\b|elementary school|public school|county of |city of /, delta: -12, reason: 'school district, public programme, or large non-profit rather than an owner-run centre' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'accounting',
    leadLabel: 'Accounting firm',
    leadPlural: 'accounting, tax preparation and bookkeeping firms',
    topic: 'client calls during busy season and the phone follow-up around returns and deadlines',
    askAbout: 'how small accounting firms handle client calls in busy season',
    situation: 'everyone is heads-down on returns in busy season, or a client calls close to a deadline after hours',
    agentHandles:
      "answers, finds out what the caller needs, and collects their name, whether they are an existing client, and a callback number",
    subjectHint: 'Help with client calls during busy season',
    registryFact:
      'either that it is a local accounting, tax preparation, or bookkeeping firm (from its own website), or, when the lead data words it that way, that it is listed in a public registry or licensee file, worded exactly as the lead data words it — whichever the lead data supports, never both',
    extraRules: [
      "Never give or imply tax, accounting, legal or financial advice, and never refer to any caller's or client's financial affairs, filings, refunds, or liabilities. Ask only about how the firm handles its phone calls.",
      'Never state or imply that the agent would answer a tax question, quote a fee, or take financial details.',
    ],
    scoreVocabulary: [
      { pattern: /\bcpa\b|accounting|accountant|bookkeep|tax (service|preparation|prep|office|advisor)|enrolled agent|\bea\b tax/, delta: 5, reason: 'accounting, tax preparation or bookkeeping firm' },
      SMALL_UP,
      { pattern: /h&r block|jackson hewitt|liberty tax|turbotax|intuit|deloitte|\bkpmg\b|\bpwc\b|pricewaterhouse|ernst (and|&) young|\bbdo\b|grant thornton|\brsm\b|crowe|bakertilly|baker tilly/, delta: -25, reason: 'national tax franchise or large accounting network' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'realestate',
    leadLabel: 'Real estate agency',
    leadPlural: 'independent real estate agencies and brokerages',
    topic: 'buyer and renter enquiry calls about listings, and viewing requests',
    askAbout: 'how small real estate agencies handle buyer and renter enquiry calls',
    situation: 'the agents are out at viewings or with clients and an enquiry call comes in',
    agentHandles:
      "answers, finds out which property or area the caller is asking about and whether they are buying or renting, and collects their name and a callback number",
    subjectHint: 'Catching enquiry calls while agents are out at viewings',
    registryFact:
      'either that it is a local real estate agency or brokerage (from its own website), or, when the lead data words it that way, that it is listed in a public licensee file or registry, worded exactly as the lead data words it — whichever the lead data supports, never both',
    extraRules: [
      'Never state or imply anything about a price, a valuation, availability, or any specific property, and give no advice about a transaction. The agent takes the enquiry and a person calls back.',
      "Never refer to, ask about, or let the agent collect a caller's race, colour, religion, national origin, sex, familial status, disability, or any other protected characteristic, and never imply the agent would screen or qualify callers.",
    ],
    scoreVocabulary: [
      { pattern: /real ?estate|realty|realtor|brokerage|lettings|estate agent|property management|\bhomes\b/, delta: 5, reason: 'real estate agency or brokerage' },
      SMALL_UP,
      { pattern: /keller williams|re\/?max|coldwell banker|century 21|\bcompass\b|sotheby|berkshire hathaway home|exp realty|douglas elliman|\bredfin\b|\bzillow\b|opendoor|howard hanna|\bhomeservices of america\b|weichert|better homes and gardens real/, delta: -25, reason: 'national real estate brand or franchise' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'lodging',
    leadLabel: 'Guesthouse',
    leadPlural: 'small guesthouses, bed and breakfasts, campgrounds and lodges',
    topic: 'booking enquiry calls and availability questions taken by phone',
    askAbout: 'how small guesthouses and campgrounds handle booking calls',
    situation: 'the owner is turning over rooms, checking guests in, or off the property and a booking call comes in',
    agentHandles:
      "answers, finds out the dates and the number of guests the caller is asking about, and collects their name and a callback number",
    subjectHint: 'Catching booking calls when you are away from the desk',
    registryFact:
      'either that it is a small guesthouse, bed and breakfast, campground, or lodge (from its own website), or, when the lead data words it that way, that it is listed in a public registry or licence file, worded exactly as the lead data words it — whichever the lead data supports, never both',
    extraRules: [
      'Never state or imply availability, a rate, a deposit, a cancellation policy, or that a booking is made, held, or confirmed. The agent takes the enquiry and a person calls back.',
      'Never state or imply that the agent connects to a booking site, channel manager, or property management system.',
    ],
    scoreVocabulary: [
      { pattern: /bed (and|&) breakfast|\bb ?& ?b\b|guest ?house|\binn\b|\blodge\b|campground|\brv park\b|cabins?|cottages?|\bmotel\b|hostel|farm ?stay|\bretreat\b/, delta: 5, reason: 'guesthouse, B&B, campground, lodge or similar small property' },
      SMALL_UP,
      { pattern: /marriott|hilton|hyatt|\bihg\b|wyndham|choice hotels|best western|holiday inn|radisson|accor|kampgrounds of america|\bkoa\b|airbnb|booking\.com|expedia|\bvrbo\b|\bresorts? international\b/, delta: -25, reason: 'hotel chain, franchise, or online travel platform' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'funeral',
    leadLabel: 'Funeral home',
    leadPlural: 'independent funeral homes',
    topic: 'the calls that come in at any hour after a death, when a family needs to reach someone',
    askAbout: 'how independent funeral homes cover the phones overnight',
    situation: 'a call comes in during the night, or while a director is with another family',
    agentHandles:
      "answers calmly, takes only the caller's name, where they are calling from, and a callback number, and tells them a director will call them straight back",
    subjectHint: 'Covering the phones overnight',
    registryFact:
      'either that it is an independent funeral home or funeral operator (from its own website), or, when the lead data words it that way, that it is listed in a public licensee file or registry, worded exactly as the lead data words it — whichever the lead data supports, never both',
    extraRules: [
      'The subject is bereavement. Write plainly, quietly, and with respect. No sales language of any kind: no benefits framing, no urgency, no scarcity, and no mention of missed revenue, lost business, growth, leads, conversion, or opportunity. Never suggest they are letting families down or losing calls.',
      'Never describe, imagine, or speculate about a death, a family\'s circumstances, or anything a caller might say. Never call a bereaved family a "customer", "client", "lead", or "enquiry".',
      'Never state or imply that the agent would comfort, counsel, advise, or handle arrangements, or that it replaces a director. It takes a name and a number so a person can call back.',
      'Make it easy to ignore: say plainly, in one short clause, that if this is not useful no reply is needed.',
    ],
    scoreVocabulary: [
      { pattern: /funeral|mortuary|cremation|cremator|memorial chapel|funeral home|undertaker/, delta: 5, reason: 'funeral home or funeral operator' },
      SMALL_UP,
      { pattern: /service corporation international|dignity memorial|\bstonemor\b|carriage services|neptune society|foundation partners|\bmatthews international\b|park lawn/, delta: -25, reason: 'national funeral group or consolidator' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'physio',
    leadLabel: 'Physiotherapy clinic',
    leadPlural: 'physiotherapy, chiropractic and allied-health clinics',
    topic: 'appointment calls, new-patient enquiries, and reschedules',
    askAbout: 'how small physiotherapy and chiropractic clinics handle appointment calls',
    situation: 'the therapists are all in with patients and the front desk is unattended',
    agentHandles:
      "answers, takes new-appointment and reschedule requests, and collects the caller's name and a callback number",
    subjectHint: 'Help with appointment calls while therapists are with patients',
    registryFact:
      'either that it is an independent physiotherapy, chiropractic, or allied-health clinic (from its own website), or, when the lead data words it that way, that it is listed in a public healthcare provider registry or government dataset, worded exactly as the lead data words it — whichever the lead data supports, never both',
    extraRules: [
      'Never give or imply clinical, medical or rehabilitation advice, and never refer to symptoms, injuries, pain, diagnoses, or treatment. Never suggest the agent assesses, triages, or prioritises anything clinical.',
      'Never state or imply that the agent books into their diary or connects to their practice-management or scheduling software; it takes the request and a person confirms.',
    ],
    scoreVocabulary: [
      { pattern: /physio|physical therapy|chiroprac|osteopath|sports (injury|medicine|therapy)|\brehab/, delta: 5, reason: 'physiotherapy, chiropractic or allied-health clinic' },
      { pattern: /podiatr|occupational therapy|speech (and language )?therapy|massage therapy|\bpelvic health\b/, delta: 3, reason: 'other allied-health clinic taking appointment calls' },
      SMALL_UP,
      { pattern: /athletico|select physical therapy|\bati physical therapy\b|concentra|the joint chiropractic|us physical therapy|ivy rehab|pivot physical therapy|\bupstream rehab\b/, delta: -25, reason: 'national physical-therapy or chiropractic chain' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'taxi',
    leadLabel: 'Taxi company',
    leadPlural: 'independent taxi and private-hire companies',
    topic: 'booking calls and dispatch, including calls that come in while the dispatcher is on another line',
    askAbout: 'how small taxi and private-hire companies handle booking calls',
    situation: 'the dispatcher is already on another call, or the phone rings overnight',
    agentHandles:
      "answers, collects the pickup address, the destination, the time wanted, and the caller's name and callback number",
    subjectHint: 'Catching booking calls when the dispatcher is on another line',
    registryFact:
      'either that it is a local taxi or private-hire company (from its own website), or, when the lead data words it that way, that it is listed in a public licensing registry or government dataset, worded exactly as the lead data words it — whichever the lead data supports, never both',
    extraRules: [
      'Never state or imply a fare, a price, an arrival or pickup time, or that a car is booked, assigned, confirmed, or on its way. The agent takes the details and a person confirms.',
      'Never state or imply that the agent connects to their dispatch system, meter, or driver app.',
    ],
    scoreVocabulary: [
      { pattern: /\btaxi\b|\bcabs?\b|private hire|minicab|car service|airport (transfer|shuttle|car)|\blivery\b|\bcar hire\b|\bsedan service\b/, delta: 5, reason: 'taxi or private-hire company' },
      { pattern: /24\/?7|24[- ]hour|around the clock|dispatch/, delta: 3, reason: 'advertises round-the-clock dispatch (phone-driven demand)' },
      SMALL_UP,
      { pattern: /\buber\b|\blyft\b|\bbolt\b|\bcurb\b|via transportation|carey international|\bgett\b|blacklane/, delta: -25, reason: 'ride-hailing platform or national ground-transport brand' },
      CHAIN_DOWN,
    ],
  },
  {
    id: 'vets',
    leadLabel: 'Veterinary practice',
    leadPlural: 'independent veterinary practices',
    topic: 'appointment calls and urgent calls about a pet',
    askAbout: 'how small veterinary practices handle appointment and urgent calls',
    situation: 'the vets and nurses are all in consults or surgery and a call comes in',
    agentHandles:
      "answers, takes appointment requests, and collects the caller's name, the animal's name and species, and a callback number",
    subjectHint: 'Help with appointment calls while the team is in consults',
    registryFact:
      'either that it is an independent veterinary practice (from its own website), or, when the lead data words it that way, that it is listed in a public licensing registry or government dataset, worded exactly as the lead data words it — whichever the lead data supports, never both',
    extraRules: [
      "Never give or imply veterinary, medical or first-aid advice, never refer to an animal's symptoms, condition, or treatment, and never suggest the agent assesses, triages, or judges how urgent anything is.",
      'If the email mentions urgent calls at all, say only that the agent takes the caller\'s details and that a person calls them back, and that anything urgent still reaches a person the way it does today.',
      'Never state or imply that the agent books into their diary or connects to their practice-management software.',
    ],
    scoreVocabulary: [
      { pattern: /\bvet(erinary|erinarian|s)?\b|animal (hospital|clinic|care cent(er|re))|pet (hospital|clinic)|equine|small animal|\bcat clinic\b/, delta: 5, reason: 'veterinary practice' },
      SMALL_UP,
      { pattern: /\bvca\b|banfield|mars veterinary|bluepearl|blue pearl|national veterinary associates|\bnva\b|thrive pet|pathway vet|\bpetco\b|petsmart|\bmedvet\b|\bvetcor\b|\bveg\b urgent/, delta: -25, reason: 'corporate veterinary group or national chain' },
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
    vertical: { leadLabel: v.leadLabel, leadPlural: v.leadPlural, defaultMaxFollowUps: 2 }, // total touches incl. the first email: 1 follow-up
  };
}

// Built by id rather than by array index: a positional lookup silently pointed
// at the wrong vertical every time the list grew.
const VERTICAL_BY_ID = Object.fromEntries(VERTICAL_DEFS.map((v) => [v.id, verticalProduct(v)])) as Record<VerticalDef['id'], ProductConfig>;

export const freight = VERTICAL_BY_ID.freight;
export const homeservices = VERTICAL_BY_ID.homeservices;
export const dental = VERTICAL_BY_ID.dental;
export const insurance = VERTICAL_BY_ID.insurance;
export const towing = VERTICAL_BY_ID.towing;
export const septic = VERTICAL_BY_ID.septic;
export const homecare = VERTICAL_BY_ID.homecare;
export const bailbonds = VERTICAL_BY_ID.bailbonds;
// batch 3
export const childcare = VERTICAL_BY_ID.childcare;
export const accounting = VERTICAL_BY_ID.accounting;
export const realestate = VERTICAL_BY_ID.realestate;
export const lodging = VERTICAL_BY_ID.lodging;
export const funeral = VERTICAL_BY_ID.funeral;
export const physio = VERTICAL_BY_ID.physio;
export const taxi = VERTICAL_BY_ID.taxi;
export const vets = VERTICAL_BY_ID.vets;

export const VERTICAL_PRODUCT_IDS = [
  'freight', 'homeservices', 'dental', 'insurance', 'towing', 'septic', 'homecare', 'bailbonds',
  'childcare', 'accounting', 'realestate', 'lodging', 'funeral', 'physio', 'taxi', 'vets',
] as const;

const PRODUCTS: Record<string, ProductConfig> = { calldesk, readaloud, ...VERTICAL_BY_ID };

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
