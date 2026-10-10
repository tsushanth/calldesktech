// Validation for per-call dynamic variables sent on the single outbound call endpoint
// (POST /phone-numbers/{id}/call). They fill {{name}} placeholders in the agent, exactly like
// a batch-call CSV column does. Deliberately conservative: callers are often no-code tools
// (HighLevel, Zapier) pasting merge fields, so we cap what can reach the prompt.
export const MAX_CALL_VARIABLES = 25;
export const MAX_CALL_VARIABLE_VALUE_LENGTH = 500;
export const MAX_CALL_VARIABLES_BYTES = 4000;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export type CallVariablesResult =
  | { ok: true; variables: Record<string, string> | undefined }
  | { ok: false; error: string };

export function parseCallVariables(input: unknown): CallVariablesResult {
  if (input === undefined || input === null) return { ok: true, variables: undefined };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'variables must be an object of string values' };
  }
  const out: Record<string, string> = {};
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_CALL_VARIABLES) {
    return { ok: false, error: `variables may have at most ${MAX_CALL_VARIABLES} keys` };
  }
  for (const [k, v] of entries) {
    if (!KEY_RE.test(k)) {
      return { ok: false, error: `Invalid variable name "${k.slice(0, 40)}": use letters, digits and underscores, starting with a letter or underscore (max 64)` };
    }
    if (typeof v !== 'string') return { ok: false, error: `variables.${k} must be a string` };
    if (v.length > MAX_CALL_VARIABLE_VALUE_LENGTH) {
      return { ok: false, error: `variables.${k} is longer than ${MAX_CALL_VARIABLE_VALUE_LENGTH} characters` };
    }
    // Same behaviour as batch CSV: empty values are dropped, not substituted.
    if (v.trim()) out[k] = v;
  }
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_CALL_VARIABLES_BYTES) {
    return { ok: false, error: `variables are larger than ${MAX_CALL_VARIABLES_BYTES} bytes in total` };
  }
  return { ok: true, variables: Object.keys(out).length ? out : undefined };
}
