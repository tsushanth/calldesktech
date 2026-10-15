// Which voice engine powers the demo call flow — "retell" (default) places
// a real outbound PSTN call via Retell, exactly as today; "poc" routes the
// same demo flow to our own call-loop-poc pipeline instead, entirely
// in-browser (no phone number, no Twilio/Retell telephony involved). Every
// other Retell code path (agent/tenant management, billing, dashboard) is
// untouched either way — this only affects which call flow the "Start Demo"
// button kicks off.
//
// A tenant's `settings.voice_engine` (set on the Settings page) takes
// priority when a tenant is already known; NEXT_PUBLIC_VOICE_ENGINE is the
// fallback for flows with no tenant yet (e.g. a brand-new demo signup).
export type VoiceEngine = 'retell' | 'poc';

export interface VoiceEngineTenantSettings {
  voice_engine?: string;
}

export function getVoiceEngine(tenantSettings?: VoiceEngineTenantSettings | null): VoiceEngine {
  if (tenantSettings?.voice_engine === 'poc') return 'poc';
  if (tenantSettings?.voice_engine === 'retell') return 'retell';
  return process.env.NEXT_PUBLIC_VOICE_ENGINE === 'poc' ? 'poc' : 'retell';
}

export function isPocEngine(tenantSettings?: VoiceEngineTenantSettings | null): boolean {
  return getVoiceEngine(tenantSettings) === 'poc';
}

export function getCallLoopWsUrl(): string {
  return process.env.NEXT_PUBLIC_CALL_LOOP_WS_URL || 'ws://localhost:8090/call';
}

/** What a visitor sees when their browser refuses to open the call connection (locked-down in-app browsers, extensions or network policies that block wss, very old browsers). */
export const CANT_START_CALL_MESSAGE = "This browser couldn't start the call. Open this page in Chrome or Safari (not inside another app) and try again.";

/**
 * Opens the call WebSocket without ever throwing: some browsers throw a SyntaxError ("the provided URL is invalid") for a perfectly good wss URL, or have no
 * WebSocket at all. Returns null when the socket could not be created, so the page can say so instead of leaving an uncaught error and a silent spinner.
 */
export function openCallSocket(url: string, create: (u: string) => WebSocket = (u) => new WebSocket(u)): WebSocket | null {
  try {
    return create(url);
  } catch {
    return null;
  }
}
