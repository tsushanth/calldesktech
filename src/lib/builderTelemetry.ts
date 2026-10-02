import { track } from '@/components/Analytics';

// Funnel events for the agent builder, so we can see where a first-time builder gets stuck.
// Never put prompt text, phone numbers, transcripts or any caller content in these properties:
// only ids, counts, enum-like labels and a short error summary.
export type BuilderEvent =
  | 'builder_opened'
  | 'builder_error'
  | 'agent_create_failed'
  | 'version_save_failed'
  | 'version_published'
  | 'test_call_started'
  | 'test_call_failed'
  | 'number_attach_failed'
  | 'builder_feedback';

export function trackBuilder(event: BuilderEvent, props: Record<string, unknown> = {}): void {
  track(event, { surface: 'builder', ...props });
}

// A short, content-free description of a failure: HTTP status (when known) and the first line of the
// message, capped so a long server error can't smuggle user content into analytics.
export function errorProps(err: unknown, status?: number): { error: string; status?: number } {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
  const firstLine = raw.split('\n')[0].trim().slice(0, 160) || 'unknown';
  return status === undefined ? { error: firstLine } : { error: firstLine, status };
}
