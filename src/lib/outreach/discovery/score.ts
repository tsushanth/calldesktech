// Rule-based fit score (0-100) for agency leads. Deliberately simple and
// explainable, no model calls. Higher = more likely to want a cheaper
// second platform and to resell it.

export interface ScoreInput {
  tier: string | null;
  location: string | null;
  description: string | null;
}

// Regions excluded from cold email. Germany, Austria and Switzerland require prior
// consent even for B2B marketing email (unfair-competition law), so we skip them.
// Everywhere else (incl. the UK and the rest of the EU) is allowed, relying on B2B
// legitimate interest plus sender identity, postal address and an unsubscribe link
// in every email. Review this list with counsel before scaling volume.
const BLOCKED_REGION_HINTS = ['germany', 'deutschland', 'austria', 'switzerland', 'liechtenstein', 'gmbh'];

// Country-code domains for the same regions; catches agencies whose listing has no location.
const BLOCKED_TLDS = ['.de', '.at', '.ch', '.li'];

export function isBlockedDomain(domain: string | null): boolean {
  const d = (domain || '').toLowerCase();
  return BLOCKED_TLDS.some((t) => d.endsWith(t));
}

export function isRegionBlocked(location: string | null, name = ''): boolean {
  const hay = `${location || ''} ${name}`.toLowerCase();
  return BLOCKED_REGION_HINTS.some((h) => hay.includes(h));
}

export function scoreLead(input: ScoreInput): number {
  const tier = (input.tier || '').toLowerCase();
  const desc = (input.description || '').toLowerCase();
  let score = 50;

  if (tier.includes('gold')) score += 15;
  else if (tier.includes('elite') || tier.includes('diamond')) score -= 10;

  if (/white.?label|reseller|resell/.test(desc)) score += 20;
  if (/small business|smb|local business|receptionist|home services|dental|real estate|trades/.test(desc)) score += 10;
  if (/inbound|outbound|voice agent|voice ai/.test(desc)) score += 5;
  if (/enterprise|call center|contact center/.test(desc)) score -= 5;

  return Math.max(0, Math.min(100, score));
}
