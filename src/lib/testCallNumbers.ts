// Pure helpers for the agent builder's Test call dialog.

export interface CallFromNumber { id: string; number: string; outbound_agent_version_id?: string | null }

export interface CallFromOption {
  id: string;
  number: string;
  /** True when this number already uses the version as its Outbound Call Agent, so a call can be placed right now. */
  ready: boolean;
  label: string;
}

/** Every number the workspace has, ready ones first, each labelled with what has to happen before it can place the call. */
export function callFromOptions(numbers: CallFromNumber[], versionId: string | null | undefined, versionNumber?: number | null): CallFromOption[] {
  const v = versionNumber != null ? `V${versionNumber}` : 'this version';
  return numbers
    .map((n) => {
      const ready = !!versionId && n.outbound_agent_version_id === versionId;
      return { id: n.id, number: n.number, ready, label: ready ? n.number : `${n.number} (not using ${v} yet)` };
    })
    .sort((a, b) => Number(b.ready) - Number(a.ready));
}

/**
 * Carrier errors read like internal jargon. When the carrier says the "from" number is not one it can place calls from,
 * say so plainly and say what to do; anything else passes through unchanged.
 */
export function friendlyCallError(message: string): string {
  if (/not (yet )?verified|not a valid caller ?id|isn't a valid caller ?id|caller id.*not|source phone number.*(not|invalid)/i.test(message)) {
    return "Calldesk can't place calls from this number: it isn't a number your carrier account owns or has verified. Choose another number in 'Call from', or buy or add one on the Phone Numbers page.";
  }
  return message;
}
