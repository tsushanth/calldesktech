// Demo links (migration 081): the pure parts. A link points at an agent version; the browser page asks for the link's
// config and then opens the voice-engine WebSocket with that flow and voice, exactly like a phone call to the agent.

export const DEMO_SLUG = /^[A-Za-z0-9_-]{16,64}$/;

export interface DemoLinkRow {
  slug: string;
  label: string;
  max_seconds: number;
  expires_at: string;
  enabled: boolean;
  /** Optional voice choices for the visitor; see parseVoiceOptions. */
  voice_options?: unknown;
}
export interface DemoVersionRow {
  tts_backend: string | null;
  tts_model: string | null;
  voice_id: string | null;
  llm_model: string | null;
}
export interface DemoFlowRow {
  nodes: unknown;
  global_settings: Record<string, unknown> | null;
}
export interface DemoVoiceOption {
  key: string;
  /** Short name the visitor sees, for example "New Zealand". */
  label: string;
  /** Optional second line, for example the voice's first name. */
  detail?: string;
  voiceId: string;
}
export interface DemoLinkConfig {
  label: string;
  maxSeconds: number;
  flow: { nodes: unknown[]; startNodeId: string; globalSettings: Record<string, unknown> };
  context: Record<string, unknown>;
  /** Present only when the link offers two or more voices. */
  voices?: DemoVoiceOption[];
  defaultVoiceKey?: string;
}

const OPTION_KEY = /^[a-z0-9][a-z0-9-]{0,23}$/;
const VOICE_ID = /^[A-Za-z0-9_-]{8,40}$/;

/**
 * Reads calldesk_demo_links.voice_options: a JSON array of { key, label, detail?, voice_id }. Anything malformed is dropped, so a bad row
 * can never break the page; at most 6 options; keys and voice ids must be unique. Returns [] when there is nothing usable.
 */
export function parseVoiceOptions(raw: unknown): DemoVoiceOption[] {
  if (!Array.isArray(raw)) return [];
  const out: DemoVoiceOption[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const item of raw) {
    if (out.length >= 6) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key.trim() : '';
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    const detail = typeof o.detail === 'string' ? o.detail.trim() : '';
    const voiceId = typeof o.voice_id === 'string' ? o.voice_id.trim() : typeof o.voiceId === 'string' ? o.voiceId.trim() : '';
    if (!OPTION_KEY.test(key) || !label || label.length > 30 || detail.length > 30 || !VOICE_ID.test(voiceId)) continue;
    if (keys.has(key) || ids.has(voiceId)) continue;
    keys.add(key); ids.add(voiceId);
    out.push({ key, label, ...(detail ? { detail } : {}), voiceId });
  }
  return out;
}

/** The context with the chosen option's voice. An unknown or missing key leaves the context unchanged. */
export function applyVoice(context: Record<string, unknown>, voices: readonly DemoVoiceOption[] | undefined, key: string | undefined): Record<string, unknown> {
  const pick = voices?.find((v) => v.key === key);
  return pick ? { ...context, voiceId: pick.voiceId } : context;
}

export function isLinkLive(link: Pick<DemoLinkRow, 'enabled' | 'expires_at'>, now: number = Date.now()): boolean {
  return link.enabled === true && Date.parse(link.expires_at) > now;
}

/** The config the browser needs, or null when the agent has no usable flow. Never carries a workspace id: the session is anonymous. */
export function buildDemoLinkConfig(link: DemoLinkRow, version: DemoVersionRow, flowRow: DemoFlowRow): DemoLinkConfig | null {
  const nodes = Array.isArray(flowRow.nodes) ? (flowRow.nodes as Array<{ id?: unknown }>) : [];
  if (nodes.length === 0 || typeof nodes[0]?.id !== 'string') return null;
  const gs = flowRow.global_settings ?? {};
  const startNodeId = typeof gs.startNodeId === 'string' && gs.startNodeId ? gs.startNodeId : (nodes[0].id as string);
  const existing = Number(gs.maxCallDurationSec) || 0;
  const maxSeconds = existing > 0 ? Math.min(existing, link.max_seconds) : link.max_seconds;
  const context: Record<string, unknown> = {};
  if (version.tts_backend) context.ttsBackend = version.tts_backend;
  if (version.tts_model) context.ttsModel = version.tts_model;
  if (version.voice_id && version.voice_id.trim()) context.voiceId = version.voice_id.trim();
  if (version.llm_model) context.model = version.llm_model;
  const options = parseVoiceOptions(link.voice_options);
  const voices = options.length >= 2 ? options : undefined; // one choice is no choice: no picker
  const defaultVoiceKey = voices ? (voices.find((v) => v.voiceId === context.voiceId) ?? voices[0]).key : undefined;
  return {
    label: link.label, maxSeconds, flow: { nodes, startNodeId, globalSettings: { ...gs, maxCallDurationSec: maxSeconds } }, context,
    ...(voices ? { voices, defaultVoiceKey } : {}),
  };
}
