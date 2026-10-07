import type { FlowNode } from '@/types';

// "Fixed greeting": the agent's opening line is plain text stored on the entry greeting node (params.spokenMessage). The call engine
// speaks it word for word the moment the call connects, with no model call, adds it to the conversation history, and the caller's reply
// is handled normally. No spokenMessage = the AI writes the greeting from the node's instructions (the old behavior). Nothing else in
// the engine is involved, so this is purely builder/default behavior.
//
// Copy rules (public repo): no timings, prices or comparisons.

export const FIXED_GREETING_TITLE = 'Fixed greeting';

/** Shown next to the toggle in the builder. */
export const FIXED_GREETING_EXPLAINER =
  'The agent says these exact words the moment the call connects, so callers hear a greeting right away instead of waiting for the AI to write one. ' +
  'After that the AI handles the conversation as usual. Turn it off and the AI writes a fresh greeting for each call from your instructions.';

/** Default text for a new agent. {{business_name}} is filled in from Business details, and publishing asks for it if it is missing. */
export const DEFAULT_FIXED_GREETING = 'Thanks for calling {{business_name}}. How can I help you today?';

type Params = FlowNode['params'];

export function hasFixedGreeting(params: Params | undefined): boolean {
  return typeof params?.spokenMessage === 'string' && params.spokenMessage.trim() !== '';
}

/** Returns params with the greeting on (text) or off (key removed). Other params are kept. Blank text counts as off. */
export function withFixedGreeting(params: Params | undefined, on: boolean, text: string = DEFAULT_FIXED_GREETING): Params | undefined {
  const { spokenMessage: _drop, ...rest } = params || {};
  void _drop;
  const next: Record<string, string> = { ...rest };
  if (on && text.trim() !== '') next.spokenMessage = text.trim();
  return Object.keys(next).length ? next : undefined;
}
