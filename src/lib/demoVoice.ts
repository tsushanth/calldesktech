// Voice settings shared by the in-browser demos (BrowserDemoCall, useLiveDemo): the ElevenLabs model every
// browser demo session speaks with, and the opt-in for the jingle + confirmation chime that call-loop attaches
// server-side (call-loop-poc callAudio.js loadBrowserDemoCallAudio; no audio travels from this app).

// eleven_v4_turbo: same low-latency class as the previous eleven_turbo_v2_5 but the newer model; the engine
// validates it against its VALID_TTS_MODELS allowlist. Overridable per deploy with NEXT_PUBLIC_DEMO_TTS_MODEL
// (any model call-loop allows for ElevenLabs, e.g. eleven_turbo_v2_5 to roll back without a code change).
export const DEFAULT_DEMO_TTS_MODEL = 'eleven_v4_turbo';

export function demoTtsModel(env: Record<string, string | undefined> = process.env): string {
  const v = (env.NEXT_PUBLIC_DEMO_TTS_MODEL ?? '').trim();
  return /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : DEFAULT_DEMO_TTS_MODEL;
}

// The TTS fields of the context message. A tenant that chose a non-ElevenLabs backend keeps it (and gets no model).
export function demoTtsFields(
  ttsBackend?: string,
  env?: Record<string, string | undefined>,
): { ttsBackend?: string; ttsModel?: string } {
  return (ttsBackend ?? 'elevenlabs') === 'elevenlabs'
    ? { ttsBackend: 'elevenlabs', ttsModel: demoTtsModel(env) }
    : { ttsBackend };
}

// Opt in to the jingle + chime only for anonymous demos (no tenant). Server-side flags still decide.
export function demoAudioFields(opts: { intro: boolean; tenantId?: string | null }): { demoAudio?: true } {
  return opts.intro || !opts.tenantId ? { demoAudio: true } : {};
}

// Appended to a demo agent's prompt. Conditional wording ("if you have the tool") because the tool only exists
// when call-loop attached the audio; with the feature off the sentence is inert.
export const DEMO_SFX_PROMPT_HINT =
  ' If you have a play_sound_effect tool: at the exact turn where you, as the business receptionist, confirm a specific' +
  ' appointment or booking with a day and time, call it in that same turn as your spoken reply (speak as normal as well).' +
  ' Call it only once, never earlier, and never mention the sound or the tool.';
