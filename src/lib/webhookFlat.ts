// "Flat" webhook payload: a single-level JSON object with stable snake_case keys, for tools that
// cannot navigate nested JSON (HighLevel's Inbound Webhook trigger, Zapier, Make). Opt-in per
// webhook (calldesk_webhooks.format = 'flat'); the default nested payload is unchanged.
//
// Transcript privacy: `transcript_url` is a link to the dashboard call page, which needs a
// signed-in workspace member. It is never a public/unguessable link, and the transcript text itself
// is not included. Add the `call_log_id`-based link only when the log row id is known.

export const WEBHOOK_FORMATS = ['nested', 'flat'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export function parseWebhookFormat(v: unknown): WebhookFormat | null {
  return typeof v === 'string' && (WEBHOOK_FORMATS as readonly string[]).includes(v) ? (v as WebhookFormat) : null;
}

const SUMMARY_MAX = 2000;
const VAR_VALUE_MAX = 500;
const E164 = /^\+[1-9]\d{6,14}$/;

const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function normalizePhone(v: unknown): string {
  const s = asStr(v);
  if (!s) return '';
  const compact = s.replace(/[\s().-]/g, '');
  return E164.test(compact) ? compact : s;
}

// "Total" key safety: lowercase letters, digits and underscores only, so no spaces or odd characters.
function safeKey(k: string): string {
  return k.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function scalarToString(v: unknown): string | undefined {
  if (typeof v === 'string') return v.slice(0, VAR_VALUE_MAX);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

export function buildFlatPayload(
  event: string,
  createdAt: string,
  data: Record<string, unknown>,
  appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, ''),
): Record<string, string | number> {
  const out: Record<string, string | number> = { event, created_at: createdAt };

  if (!event.startsWith('call.')) {
    // Non-call events (sms.*, webhook.test): pass top-level scalars through, drop nested values.
    for (const [k, v] of Object.entries(data)) {
      const key = safeKey(k);
      const s = scalarToString(v);
      if (key && s !== undefined && !(key in out)) out[key] = typeof v === 'number' ? v : s;
    }
    return out;
  }

  const direction = asStr(data.direction) ?? '';
  const vars = rec(data.variables);
  const analysis = rec(data.analysis);
  const builtIn = rec(analysis.built_in);
  const custom = rec(analysis.custom);

  // The other party: the callee on outbound calls, the caller on inbound ones.
  const phone = normalizePhone(direction === 'outbound' ? (data.to_number ?? data.caller_phone) : (data.caller_phone ?? data.to_number));

  const first = asStr(vars.first_name), last = asStr(vars.last_name);
  const name =
    asStr(vars.contact_name) ?? asStr(vars.name) ?? (first ? [first, last].filter(Boolean).join(' ') : undefined) ??
    asStr(custom.name) ?? asStr(custom.caller_name) ?? asStr(custom.contact_name);
  const email = asStr(vars.email) ?? asStr(custom.email);

  const summary = asStr(builtIn.call_summary) ?? asStr(analysis.summary) ?? asStr(data.summary) ?? '';
  const callLogId = asStr(data.call_log_id);

  out.call_id = asStr(data.call_id) ?? '';
  out.phone = phone;
  if (name) out.name = name;
  if (email) out.email = email;
  out.summary = summary.slice(0, SUMMARY_MAX);
  out.outcome = asStr(data.outcome) ?? '';
  out.duration_seconds = typeof data.duration_seconds === 'number' ? data.duration_seconds : 0;
  out.direction = direction;
  out.transcript_url = callLogId ? `${appUrl}/dashboard/calls/${encodeURIComponent(callLogId)}` : '';
  out.started_at = asStr(data.started_at) ?? '';
  out.ended_at = asStr(data.ended_at) ?? '';
  out.agent_name = asStr(data.agent_name) ?? '';

  for (const [k, v] of Object.entries(vars)) {
    const key = safeKey(k);
    const s = scalarToString(v);
    if (key && s !== undefined) out[`var_${key}`] = s;
  }
  return out;
}
