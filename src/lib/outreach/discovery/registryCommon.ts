import { titleCase as baseTitleCase } from './freightFmcsa';

// freight's titleCase turns "DICK'S" into "Dick'S"; fix possessives and keep everything else.
export function titleCase(name: string): string {
  return baseTitleCase(name).replace(/(\w)'S\b/g, "$1's");
}

// Shared shapes and pure helpers for the no-email registry sources (towing,
// septic, homecare). A registry row gives a real business identity (name, city,
// state, licence, phone) but no email; websiteDiscovery.ts then resolves a site.

export interface RegistryLead {
  sourceKey: string; // globally unique, product-prefixed, e.g. "towing:wa:05317"
  name: string; // display/trade name
  legalName: string | null;
  city: string | null;
  state: string | null;
  phone: string | null; // formatted, stored on signals.registry for human phone follow-up
  licenseId: string;
  registryName: string; // e.g. "Washington State Department of Licensing"
  typeLabel: string; // e.g. "registered tow truck operator"
  contactName: string | null; // registry contact person (never used in drafts)
  location: string | null;
  // Registry-only factual sentence used as the lead description (the ONLY thing a draft may state).
  description: string;
  signalDetail: string;
  // Score adjustment on top of the product vocabulary and reasons for it.
  adjust: number;
  reasons: string[];
  // Some registries publish the licensee's business email (FL DFS, DE DNREC).
  // When set, the lead is inserted contact_status 'found' and pre-enriched, the
  // way the FMCSA freight source does; when absent, stageEnrich has to resolve
  // the business's own website and email first.
  email?: string | null;
  // Public registry page the email came from; stored as contact_source_url.
  contactSourceUrl?: string | null;
  // Some registers publish the business's own website even though they publish no
  // email (the CQC directory and the DVSA operator licences both do). Setting it
  // here saves stageEnrich an LLM website search per lead and is more reliable
  // than one. When absent the email's domain is used, exactly as before.
  domain?: string | null;
  // ISO-3166 alpha-2 country, set ONLY by the non-US registry sources. Absent (or
  // 'US') means a domestic lead and nothing changes. Anything else makes this an
  // international lead and pipeline.registryLeadRow stores it ON HOLD: see
  // INTL_HOLD_REASON below.
  country?: string | null;
}

export interface RegistryResult {
  candidates: RegistryLead[];
  scanned: number;
  rejected: Record<string, number>;
  errors: string[];
}

export function emptyResult(): RegistryResult {
  return { candidates: [], scanned: 0, rejected: {}, errors: [] };
}

export function reject(result: RegistryResult, reason: string) {
  result.rejected[reason] = (result.rejected[reason] ?? 0) + 1;
}

// "5122584000" / "(509) 455-8622" / "+1 509-455-8622" -> "(509) 455-8622"; null if not a 10-digit US number.
export function formatUsPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function cityState(city: string | null | undefined, state: string | null | undefined): string | null {
  const c = (city ?? '').trim();
  const s = (state ?? '').trim();
  if (c && s) return `${titleCase(c)}, ${s.toUpperCase()}`;
  return s ? s.toUpperCase() : c ? titleCase(c) : null;
}

// Description text: only what the registry record supports. Never headcount,
// revenue, problems, or anything about operations.
// `listNoun` names what the source actually is: most are a "registry", but the
// FL DFS export is a "licensee file" and the CMS source is a "dataset". The
// description must not call something a registry when it is not one.
export function describeRegistryLead(a: { typeLabel: string; registryName: string; location: string | null; legalName: string | null; name: string; listNoun?: string }): string {
  let d = `Listed in the ${a.registryName} ${a.listNoun ?? 'registry'} as a ${a.typeLabel}`;
  if (a.location && a.location.includes(',')) d += `, based in ${a.location}`;
  // The legal/registered name is kept in signals.registry only (it can be a person's
  // name for a sole proprietor), never in the draft-visible description.
  return `${d}.`;
}

// ---- international sources -------------------------------------------------
//
// THE SAFETY RULE. Every lead from a non-US public register is stored ON HOLD:
// `region_blocked = true` plus `signals.intlHold = { country, reason }`. That is
// applied once, centrally, in pipeline.registryLeadRow, so no individual source
// can forget it. Nothing international can be drafted or emailed while the hold
// stands: stageDraft/stageForm only select `region_blocked = false` rows,
// sender.ts re-checks the flag and refuses the send, and stageEnrich skips
// region-blocked leads too, so a held lead is completely inert — not even its
// website is looked up. A human releases one country at a time with
// `harness/outreach/release-country.ts`.
export const INTL_HOLD_REASON = 'international: pending compliance review';

export interface IntlHold {
  country: string;
  reason: string;
}

// DE/AT/CH (and LI) require prior consent even for B2B marketing email, so they
// can never be released — score.ts already region-blocks them by location and
// domain, and release-country.ts refuses them by country code. Kept here so the
// rule has one home shared by the pipeline and the release script.
export const NEVER_RELEASE_COUNTRIES = new Set(['DE', 'AT', 'CH', 'LI']);

export function isNeverReleasable(country: string | null | undefined): boolean {
  return NEVER_RELEASE_COUNTRIES.has((country ?? '').trim().toUpperCase());
}

// The whole gate release-country.ts applies before it touches the database, as a
// pure function so it can be tested. Kept here rather than in the harness script
// so the rule cannot be re-implemented differently somewhere else.
export type ReleaseDecision = { ok: true; country: string } | { ok: false; reason: string };

export function decideRelease(raw: string | null | undefined): ReleaseDecision {
  const c = (raw ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return { ok: false, reason: 'COUNTRY is required and must be an ISO-3166 alpha-2 code, e.g. COUNTRY=FR' };
  if (NEVER_RELEASE_COUNTRIES.has(c)) {
    return { ok: false, reason: `${c} can never be released: ${[...NEVER_RELEASE_COUNTRIES].sort().join('/')} require prior consent for B2B marketing email` };
  }
  if (c === 'US') return { ok: false, reason: 'US leads are not held in the first place; there is nothing to release' };
  return { ok: true, country: c };
}

// Normalises a country code, returning null for US/blank so a domestic lead
// never accidentally acquires a hold.
export function intlCountry(raw: string | null | undefined): string | null {
  const c = (raw ?? '').trim().toUpperCase();
  return !c || c === 'US' || c.length !== 2 ? null : c;
}

// "LYON" + "FR" -> "Lyon, FR". Same shape as cityState (city, comma, uppercase
// code) on purpose: the lead's `location` is what language.detectDraftLanguage
// reads to pick the draft language, and what discoverWebsite uses to
// disambiguate a business by place.
export function cityCountry(city: string | null | undefined, country: string | null | undefined): string | null {
  return cityState(city, country);
}

// Non-US phone numbers have no single national format to normalise to, so the
// published number is kept as-is, only tidied (collapsed whitespace, no stray
// punctuation). Returns null unless there are at least 6 digits, which rejects
// the empty and placeholder values these registers contain.
export function formatIntlPhone(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/[^\d+()\-\s.]/g, '').replace(/\s+/g, ' ').trim();
  if ((v.match(/\d/g) ?? []).length < 6) return null;
  return v.slice(0, 40);
}

// Registry name with the DBA/trade name preferred for display: "LEGAL LLC - DBA Trade Name" -> "Trade Name".
export function splitDba(raw: string): { legal: string; dba: string | null } {
  const m = /^(.*?)\s+(?:-\s*)?(?:d\/b\/a|dba|a\/k\/a|aka)\.?\s+(.+)$/i.exec(raw.trim());
  if (!m) return { legal: raw.trim(), dba: null };
  return { legal: m[1].replace(/[-,\s]+$/, '').trim(), dba: m[2].trim() };
}
