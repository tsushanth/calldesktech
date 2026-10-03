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

// The workspace a demo call may attach to. A capability (sample) demo is anonymous by design: a workspace id saved by an earlier
// session (the owner's own business, a customer trial) must never leak into it, so it gets none.
export function demoTenantId(demoType: string | null | undefined, tenantId: string | null | undefined): string | null {
  return demoType === 'sample' ? null : tenantId ?? null;
}

// Opt in to the jingle + chime only for anonymous demos (no tenant). Server-side flags still decide.
export function demoAudioFields(opts: { intro: boolean; tenantId?: string | null }): { demoAudio?: true } {
  return opts.intro || !opts.tenantId ? { demoAudio: true } : {};
}

// Appended to a demo agent's prompt. Conditional wording ("if you have the tool") because the tool only exists
// when call-loop attached the audio; with the feature off the sentence is inert.
// The chime is a model TOOL CALL, and a tool call ends the model's message: anything the model meant to say AFTER it
// (e.g. reading the caller's number back) is never generated and the agent seems to cut itself off. Measured against the
// live engine (4 runs each, same conversation): the old wording ("call it in that same turn") finished the read-back in
// 1 of 3 runs; "call it first" 2 of 3; "say everything, then call it as the very last thing" 4 of 4. So the hint says that.
export const DEMO_SFX_PROMPT_HINT =
  ' If you have a play_sound_effect tool: when you, as the business receptionist, confirm a specific appointment or booking' +
  ' with a day and time, first say your COMPLETE reply out loud (the confirmation and anything else you want to say,' +
  ' including reading back the details), and only then, as the very last thing in that turn after your final word, call' +
  ' play_sound_effect. Never call it before you have finished speaking, call it only once, and never mention the sound or the tool.';
