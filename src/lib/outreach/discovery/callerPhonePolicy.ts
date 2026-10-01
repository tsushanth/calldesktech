import { looksLikeIndividual } from './individualName';

// Callers' phone lists are built from leads.phone. A registry phone must NOT go there when it is
// probably someone's personal or home line: a sole proprietor licensed in their own name, a
// home-based provider (family/group-family child care run from a residence), or a "business" whose
// name is just a person. Those leads keep their registry facts and any published business email and
// still go through website discovery; they simply never get a callable phone from the registry.
// Policy decided 2026-10-01: exclude them from callers' phone lists.

// Program/type wording that marks a residence-based provider across the state child care files.
export const HOME_BASED_RE = /\b(family child ?care|group family|family day ?care|family child-care home|in[- ]?home(?:\s+\w+){0,2}\s+(?:day ?care|child ?care|childcare|preschool|nursery)|home[- ]?based|home day ?care|day ?care home|child[- ]?care home|registered (?:family )?(?:child ?care )?home|licensed (?:family |group )?(?:child ?care )?home(?!\s+(?:care|health|nursing|medical)))\b/i;

export interface CallerPhoneFacts {
  name: string;
  /** The registry says the licensee is an individual / sole owner. */
  soleProprietor?: boolean;
  /** The registry says the provider operates from a home. */
  homeBased?: boolean;
  /** Free text such as "Family Child Care Home" / the program or licence type label. */
  typeLabel?: string | null;
}

/** Returns why the registry phone must stay off callers' lists, or null when it is fine to use. */
export function callerPhoneExclusion(f: CallerPhoneFacts): string | null {
  if (f.soleProprietor) return 'sole proprietor';
  if (f.homeBased || (f.typeLabel && HOME_BASED_RE.test(f.typeLabel))) return 'home-based provider';
  if (looksLikeIndividual(f.name)) return 'person-named business';
  return null;
}
