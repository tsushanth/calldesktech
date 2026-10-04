// Browser-safe pieces of the pilot outbound block (no server imports): codes, messages, UI error text and call classification.

export const PILOT_BLOCKED_CODE = 'pilot_blocked';
export const PILOT_BLOCKED_MESSAGE =
  'Outbound calling is paused for this workspace because its pilot has ended or reached its limit. Contact support to continue.';

export function pilotBlockedBody() {
  return { error: PILOT_BLOCKED_CODE, code: PILOT_BLOCKED_CODE, message: PILOT_BLOCKED_MESSAGE };
}

/** Text for a UI to show for an API error body: the friendly message for pilot_blocked, else the plain error. */
export function apiErrorText(body: unknown, fallback: string): string {
  const b = (body ?? {}) as { code?: unknown; message?: unknown; error?: unknown };
  if (b.code === PILOT_BLOCKED_CODE && typeof b.message === 'string') return b.message;
  return typeof b.error === 'string' && b.error ? b.error : fallback;
}

/** Detail for an MCP tool error from a failed internal API call: names pilot_blocked explicitly so an agent can tell it apart. */
export function apiFailureDetail(body: unknown, status: number): string {
  const b = (body ?? {}) as { code?: unknown; message?: unknown };
  if (b.code === PILOT_BLOCKED_CODE && typeof b.message === 'string') return `${PILOT_BLOCKED_CODE}: ${b.message}`;
  return apiErrorText(body, `HTTP ${status}`);
}

// ---- Calls the engine turned away for a blocked pilot (outcome 'abandoned', duration 0, analysis.blocked === 'pilot')

export function isPilotBlockedCall(call: { analysis?: unknown } | null | undefined): boolean {
  const a = call?.analysis;
  return !!a && typeof a === 'object' && !Array.isArray(a) && (a as Record<string, unknown>).blocked === 'pilot';
}

/** Rows that belong in customer-facing rates, counts and averages. */
export function excludePilotBlocked<T extends { analysis?: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => !isPilotBlockedCall(r));
}
