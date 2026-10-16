// Demo links (migration 081): the pure parts. A link points at an agent version; the browser page asks for the link's
// config and then opens the voice-engine WebSocket with that flow and voice, exactly like a phone call to the agent.

export const DEMO_SLUG = /^[A-Za-z0-9_-]{16,64}$/;

export interface DemoLinkRow {
  slug: string;
  label: string;
  max_seconds: number;
  expires_at: string;
  enabled: boolean;
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
export interface DemoLinkConfig {
  label: string;
  maxSeconds: number;
  flow: { nodes: unknown[]; startNodeId: string; globalSettings: Record<string, unknown> };
  context: Record<string, unknown>;
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
  return { label: link.label, maxSeconds, flow: { nodes, startNodeId, globalSettings: { ...gs, maxCallDurationSec: maxSeconds } }, context };
}
