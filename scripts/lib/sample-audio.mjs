// Jingle + sound-effect support for the vertical sample calls (pure helpers, no I/O, unit-tested in
// test/lib/sampleAudio.test.ts). A sample call's demo agent is flow-less, so its sounds travel inline with the
// call request (call-loop-poc: sampleCallee.callAudio) instead of coming from a tenant's saved assets.
//
// Design: ONE shared intro jingle and two shared effects, generated once (scripts/generate-sample-audio.mjs),
// reused across verticals, so every sample has the same sonic identity and the cost is 3 generations, not 26.
// Each scenario's `audio` block only chooses which effect it uses and tells the agent WHEN to play it.
//
// Honesty rule: most of these demo agents are instructed to NEVER confirm a booking/tour/availability/fare.
// A "confirmed!" chime there would contradict the agent and over-claim in outreach material. So the
// confirmation chime is used only where the agent really confirms (dental, home services, septic, towing,
// insurance callback); the rest use a soft "received" tone for "I have your details, someone will call you".

export const SHARED_SOUNDS = {
  intro_jingle: { prompt: 'a short upbeat three-note bell jingle, bright and friendly', durationSec: 4 },
  confirmation_chime: { prompt: 'a soft two-note rising confirmation chime, warm and positive', durationSec: 2 },
  received_chime: { prompt: 'a single soft gentle notification ding, subtle and calm', durationSec: 2 },
};
const EFFECT_SOUNDS = ['confirmation_chime', 'received_chime'];

// A cheerful sound would be tone-deaf here (funeral, bail bonds, home care), and agency is calldesk's own
// partner-marketing sample, not a customer vertical.
export const NO_AUDIO_VERTICALS = ['funeral', 'bailbonds', 'homecare', 'agency'];

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_EFFECTS = 3;

/** Returns an array of error strings for a scenario's optional `audio` block; empty means valid. */
export function validateAudioConfig(sc) {
  const errs = [];
  const at = `scenario ${sc?.id || '?'}`;
  if (!sc || sc.audio === undefined) return errs;
  if (NO_AUDIO_VERTICALS.includes(sc.id)) return [`${at}: audio is not allowed for this vertical (no audio: sensitive or not a customer vertical)`];
  const a = sc.audio;
  if (!a || typeof a !== 'object') return [`${at}: audio must be an object`];
  if (a.jingle !== undefined && typeof a.jingle !== 'boolean') errs.push(`${at}: audio.jingle must be true/false`);
  const effects = a.effects ?? [];
  if (!Array.isArray(effects)) return [...errs, `${at}: audio.effects must be an array`];
  if (effects.length > MAX_EFFECTS) errs.push(`${at}: audio.effects can have at most ${MAX_EFFECTS} entries`);
  for (const e of effects) {
    if (!e || !EFFECT_SOUNDS.includes(e.sound)) errs.push(`${at}: effect sound must be one of ${EFFECT_SOUNDS.join(', ')}`);
    if (!e || typeof e.name !== 'string' || !NAME_RE.test(e.name)) errs.push(`${at}: effect name must be a slug (letters, numbers, _ and -)`);
    if (!e || typeof e.description !== 'string' || !e.description.trim()) errs.push(`${at}: effect description must be non-empty (the agent reads it to decide when to play it)`);
  }
  return errs;
}

/**
 * Builds the inline `callAudio` payload for a scenario from the shared, already-generated sounds
 * ({ intro_jingle: {audio}, confirmation_chime: {audio}, ... } with base64 mu-law@8kHz audio).
 * Returns null when the scenario has no audio. THROWS if a needed sound is missing: a sample that was
 * supposed to have audio must never silently go out without it.
 */
export function buildSampleCallAudio(sc, shared) {
  if (!sc?.audio) return null;
  const need = (key) => {
    const s = shared?.[key];
    if (!s || typeof s.audio !== 'string' || !s.audio) throw new Error(`shared sound "${key}" has not been generated: run scripts/generate-sample-audio.mjs first`);
    return s.audio;
  };
  const out = { jingle: null, effects: [] };
  if (sc.audio.jingle) out.jingle = { name: 'intro', audio: need('intro_jingle') };
  for (const e of sc.audio.effects ?? []) out.effects.push({ name: e.name, description: e.description, audio: need(e.sound) });
  return out;
}

// Without this the model plays the effect early or not at all (observed: it waited to be asked for a phone
// number first and never reached the confirmation inside a short call). The tool's own description says
// WHEN; this says to do it in the same turn as the spoken line and to keep the sound itself unmentioned.
export const AUDIO_PROMPT_HINT =
  ' SOUND EFFECT: you have a play_sound_effect tool. At the exact turn where the moment described in the tool' +
  ' occurs, call it in that same turn as your spoken reply (speak as normal as well). Call it only once, never' +
  ' earlier than that moment, and do not mention the sound or the tool. Keep the conversation efficient: ask one short' +
  ' question at a time, ask only for what you genuinely need, never re-ask something you already have, and skip optional' +
  ' extras (for example a member ID) so the call reaches that moment promptly.';

export function withAudioPromptHint(agentPrompt, audio) {
  if (!audio || !(audio.effects?.length > 0)) return agentPrompt;
  return agentPrompt + AUDIO_PROMPT_HINT;
}

// Appended to EVERY sample's caller persona. The demo agent is built to ask "is that the full number including area
// code?" whenever it is given fewer than 10 digits, and a persona that does not say what number to give makes the
// caller AI invent a fictional 7-digit one (the 555-01xx style), which trips that rule on every call and costs a
// back-and-forth turn. No literal number here: the scenario validator forbids phone numbers in prompts.
export const CALLER_PHONE_RULE =
  ' If you are asked for a callback phone number, always give a complete ten-digit US number in one go, area code' +
  ' first, followed by a 555-01xx style number so it is clearly fictional, never a seven-digit number. If it is' +
  ' read back correctly, just confirm it.';

/**
 * The /place-test-call request for one scenario. Without audio this is exactly the request the generator
 * always sent. With audio, the demo agent gets the inline sounds plus the same-turn prompt hint. Throws if a
 * needed shared sound is missing (see buildSampleCallAudio), so nothing is dialed.
 */
export function buildPlaceCallRequest(sc, { callee, shared }) {
  const callAudio = buildSampleCallAudio(sc, shared);
  return {
    callAudio,
    body: {
      toNumber: callee, shopper: true, record: true,
      persona: sc.callerPersona + CALLER_PHONE_RULE,
      sampleCallee: {
        systemPrompt: callAudio ? withAudioPromptHint(sc.agentPrompt, sc.audio) : sc.agentPrompt,
        greeting: sc.greeting, voice: sc.agentVoice, stability: 0.8,
        ...(callAudio ? { callAudio } : {}),
      },
      shopperVoice: { voice: sc.callerVoice, stability: 0.8 },
    },
  };
}
