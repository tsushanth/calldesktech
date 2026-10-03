import { createHash } from 'crypto';
import { normalizeNanp } from '@/lib/outboundCalling';

// Freight-vertical rules that must hold at every stage (discovery, drafting, follow-up, send), kept in
// one pure module so they can be unit tested and cannot drift between callers.
//
// COMPLIANCE (internal-docs/legal/OUTBOUND-CONSENT-RESEARCH.md): the only channels used on a freight
// prospect are CAN-SPAM-compliant cold EMAIL and HUMAN founder/caller phone calls. Nothing in the
// freight path sends a text or places an AI-voice call to a prospect. A lead's `phone` is read ONLY by
// the human caller tooling (scripts/build-call-batch.ts, /caller, the softphone route) and by the admin
// queue display; it must never be passed to an automated dialer or an AI voice agent.

export const FREIGHT_PRODUCT = 'calldesk:freight';

/** True for the vertical id ('freight') and the stored product value ('calldesk:freight'). */
export function isFreightProduct(product: string | null | undefined): boolean {
  return product === 'freight' || product === FREIGHT_PRODUCT;
}

// ---- US-only guard -----------------------------------------------------------------------------

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'GU', 'VI', 'AS', 'MP',
]);

export function isUsStateCode(code: string | null | undefined): boolean {
  return !!code && US_STATE_CODES.has(code.trim().toUpperCase());
}

// Country-code TLDs that are never a US freight broker's own site (the lead's domain, when present).
const NON_US_TLD = /\.(no|uk|fr|ee|br|mx|ca|de|at|ch|se|dk|fi|nl|be|es|it|pl|ie|sg|au|nz|in|za|jp|cn)$/i;

export interface FreightLeadFacts {
  source_key?: string | null;
  region_blocked?: boolean | null;
  location?: string | null;
  domain?: string | null;
  contact_email?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signals?: any;
}

/**
 * The US-brokers-only rule for freight. Pure; needs only fields already on the lead row, so it applies to
 * existing leads without touching production data. Strict by design: a lead we cannot show is a US
 * business is not drafted or sent.
 *
 *  - held / region-blocked leads: never
 *  - international hold marker (signals.intlHold): never, even if a human has since released the country
 *  - source_key `freight:mc:*` (FMCSA broker authority, loaded with bus_ctry_code = 'US'): yes
 *  - any other `freight:*` source key (freight:gb-dvsa:*, freight:no:*, ...): no
 *  - otherwise (no registry key): only when the stored location ends in a US state code and neither the
 *    domain nor the email carries a non-US country TLD
 */
export function isUsFreightLead(lead: FreightLeadFacts): boolean {
  if (lead.region_blocked) return false;
  if (lead.signals?.intlHold) return false;
  const key = (lead.source_key ?? '').toLowerCase();
  if (key.startsWith('freight:mc:')) return true;
  if (key.startsWith('freight:')) return false;
  const domain = (lead.domain ?? '').trim().toLowerCase();
  const emailDomain = (lead.contact_email ?? '').split('@')[1]?.trim().toLowerCase() ?? '';
  if (NON_US_TLD.test(domain) || NON_US_TLD.test(emailDomain)) return false;
  const regState = typeof lead.signals?.registry?.state === 'string' ? lead.signals.registry.state : null;
  if (regState) return isUsStateCode(regState);
  const m = /,\s*([A-Za-z]{2})\s*$/.exec((lead.location ?? '').trim());
  return !!m && isUsStateCode(m[1]);
}

/** Convenience for callers that hold the product too: non-freight leads are never filtered by this rule. */
export function passesFreightUsGuard(product: string | null | undefined, lead: FreightLeadFacts): boolean {
  return !isFreightProduct(product) || isUsFreightLead(lead);
}

export const FREIGHT_NON_US_ERROR = 'freight outreach is US-only: this lead is not a US business address';

// ---- phone (HUMAN calls only) ------------------------------------------------------------------

/**
 * Normalizes a registry phone to E.164 US (+1XXXXXXXXXX) or null. Rejects implausible numbers: wrong
 * length, repeated digits, area code or exchange starting 0/1, 555-01XX fictional range, premium 900.
 * The result is stored in leads.phone for HUMAN callers only (see the header comment).
 */
export function normalizeFreightPhone(raw: string | null | undefined): string | null {
  const e164 = normalizeNanp(String(raw ?? ''));
  if (!e164) return null;
  const national = e164.slice(2);
  if (/^(\d)\1{9}$/.test(national)) return null;
  if (national.slice(3, 6) === '555' && /^01\d\d$/.test(national.slice(6))) return null;
  return e164;
}

// ---- experiment arm ----------------------------------------------------------------------------

export type FreightArm = 'free_week' | 'demo';
export const FREIGHT_ARMS: readonly FreightArm[] = ['free_week', 'demo'];

/** Deterministic 50/50 split by lead id: stable across runs, retries and follow-ups. */
export function pickFreightArm(leadId: string): FreightArm {
  const byte = createHash('sha256').update(`freight-arm:${leadId}`).digest()[0];
  return byte % 2 === 0 ? 'free_week' : 'demo';
}

/**
 * The experiment is OFF unless OUTREACH_FREIGHT_EXPERIMENT=on. It must stay off until migration
 * 067_outreach_experiment_arm.sql is applied: arm assignment writes the `experiment_arm` column.
 * With it off every freight email uses the 'free_week' wording and no arm is stored.
 */
export function freightExperimentOn(): boolean {
  return (process.env.OUTREACH_FREIGHT_EXPERIMENT ?? '').trim().toLowerCase() === 'on';
}

/** The arm to draft a freight email under, or null when the experiment is off / not freight. */
export function armForLead(product: string | null | undefined, leadId: string): FreightArm | null {
  return isFreightProduct(product) && freightExperimentOn() ? pickFreightArm(leadId) : null;
}

export interface ArmStatRow { arm: FreightArm | string; sent: number; replied: number; replyRate: number }

/** Per-arm first-email reply attribution from sent step-1 messages carrying experiment_arm. Pure. */
export function computeArmStats(rows: { experiment_arm?: string | null; replied?: boolean }[]): ArmStatRow[] {
  const by = new Map<string, { sent: number; replied: number }>();
  for (const r of rows) {
    if (!r.experiment_arm) continue;
    const e = by.get(r.experiment_arm) ?? { sent: 0, replied: 0 };
    e.sent++;
    if (r.replied) e.replied++;
    by.set(r.experiment_arm, e);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([arm, e]) => ({ arm, ...e, replyRate: e.sent ? e.replied / e.sent : 0 }));
}
