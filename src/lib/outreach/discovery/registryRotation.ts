import type { RegistryResult } from './registryCommon';
import { findWaContractorCandidates } from './homeservicesRegistry';
import { findHomecareCandidates } from './homecareRegistry';
import { findNycDobCandidates } from './nycDobLicenses';
import { findVaDporCandidates } from './vaDporContractors';
import { findArContractorCandidates } from './arkansasContractors';
import { findCaCdphCandidates } from './homecareCaCdph';
import { findTxEmployerCandidates, txSupportsVertical } from './txWorkersComp';

// Source rotation for the verticals that batch 2 added sources to. Each source
// is still individually capped at `max` (OUTREACH_REGISTRY_MAX_PER_RUN), and
// only ONE source is fetched per run, so adding sources widens coverage over
// time without increasing per-run volume or per-run network cost.
//
// Rotation is by hourly slot rather than by day so that the several-times-a-day
// runs do not all hit the same file.

const SLOT_MS = 60 * 60_000;

export function slotFor(now: Date): number {
  return Math.floor(now.getTime() / SLOT_MS);
}

// ---- homeservices ----------------------------------------------------------
// WA L&I (~76k registrations, no email) plus the three batch-2 email-bearing
// contractor sources. Virginia is by far the largest email-bearing one, so it
// takes two slots in five.
export type HomeservicesSource = 'wa' | 'nyc' | 'va' | 'ar';

export function homeservicesSourceForSlot(slot: number): HomeservicesSource {
  return (['wa', 'nyc', 'va', 'ar', 'va'] as const)[((slot % 5) + 5) % 5];
}

export interface RotationOpts {
  now?: Date;
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
}

export async function findHomeservicesCandidates(
  max: number, opts: RotationOpts & { source?: HomeservicesSource } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? homeservicesSourceForSlot(slotFor(now));
  const inner = { now, isKnown: opts.isKnown, log: opts.log };
  if (source === 'nyc') return findNycDobCandidates(max, inner);
  if (source === 'va') return findVaDporCandidates(max, inner);
  if (source === 'ar') return findArContractorCandidates(max, inner);
  return findWaContractorCandidates(max, inner);
}

// ---- homecare --------------------------------------------------------------
// findHomecareCandidates already rotates IL / CMS / NY / MO by day; California
// is added alongside it rather than inside it, so batch 1's rotation is
// untouched. CDPH is the only home-care source with an email, so it takes two
// slots in five.
export type HomecareRotationSource = 'batch1' | 'ca';

export function homecareSourceForSlot(slot: number): HomecareRotationSource {
  const m = ((slot % 5) + 5) % 5;
  return m === 1 || m === 3 ? 'ca' : 'batch1';
}

export async function findHomecareRegistryCandidates(
  max: number, opts: RotationOpts & { source?: HomecareRotationSource } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? homecareSourceForSlot(slotFor(now));
  const inner = { now, isKnown: opts.isKnown, log: opts.log };
  return source === 'ca' ? findCaCdphCandidates(max, inner) : findHomecareCandidates(max, inner);
}

// ---- Texas workers' compensation ------------------------------------------
// The Texas subscriber file feeds six verticals, so instead of being added to
// each vertical's own rotation it takes one slot in six for whichever vertical
// is running. It has no contact detail at all, so it is the lowest-yield source
// and gets the smallest share.
export function useTxForSlot(slot: number): boolean {
  return ((slot % 6) + 6) % 6 === 5;
}

// The single entry point stageRegistry uses for the batch-2 verticals: returns
// null when this run's slot is not a Texas slot (or the vertical has no NAICS
// class), so the caller falls through to the vertical's own source.
export async function findTxCandidatesForSlot(
  productId: string, max: number, opts: RotationOpts = {},
): Promise<RegistryResult | null> {
  const now = opts.now ?? new Date();
  if (!txSupportsVertical(productId) || !useTxForSlot(slotFor(now))) return null;
  const res = await findTxEmployerCandidates(productId, max, { now, isKnown: opts.isKnown, log: opts.log });
  // A Texas outage must not cost the run its leads: fall back to the vertical's
  // own source rather than returning an empty, failed result.
  if (!res.candidates.length && res.errors.length) return null;
  return res;
}
