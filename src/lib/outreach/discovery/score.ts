// Rule-based fit score (0-100) for agency leads. Deliberately simple and
// explainable, no model calls. Higher = more likely to want a cheaper
// second platform and to resell it.

export interface ScoreInput {
  tier: string | null;
  location: string | null;
  description: string | null;
}

// GDPR/UK-GDPR/Swiss-DPA: leads in these regions are excluded from
// outreach until a lawful-basis process exists.
const BLOCKED_REGION_HINTS = [
  'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech', 'denmark', 'estonia', 'finland', 'france',
  'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta',
  'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden',
  'united kingdom', 'england', 'scotland', 'wales', 'switzerland', 'europe', ', uk', 'gmbh',
];

// Country-code domains for the same excluded regions; catches agencies whose
// directory listing has no location.
const BLOCKED_TLDS = ['.uk', '.de', '.fr', '.es', '.it', '.nl', '.be', '.at', '.ch', '.se', '.dk', '.fi', '.ie', '.pt', '.pl', '.cz', '.gr', '.hu', '.ro', '.bg', '.hr', '.sk', '.si', '.lt', '.lv', '.ee', '.lu', '.mt', '.cy', '.eu'];

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
