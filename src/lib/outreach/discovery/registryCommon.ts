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

// Registry name with the DBA/trade name preferred for display: "LEGAL LLC - DBA Trade Name" -> "Trade Name".
export function splitDba(raw: string): { legal: string; dba: string | null } {
  const m = /^(.*?)\s+(?:-\s*)?(?:d\/b\/a|dba|a\/k\/a|aka)\.?\s+(.+)$/i.exec(raw.trim());
  if (!m) return { legal: raw.trim(), dba: null };
  return { legal: m[1].replace(/[-,\s]+$/, '').trim(), dba: m[2].trim() };
}
