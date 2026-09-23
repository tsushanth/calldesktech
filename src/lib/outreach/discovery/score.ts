// Rule-based fit score (0-100) for agency leads, with named reasons so the
// admin UI can show WHY a lead scored the way it did. Deliberately simple and
// explainable, no model calls. Higher = more likely to want a cheaper second
// platform and to resell it.
//
// The description-text vocabulary (white-label/SMB/voice-AI/enterprise
// phrases) is product-specific and lives in products.ts as
// ProductConfig.scoreVocabulary; scoreLead defaults to calldesk's vocabulary
// so every existing caller (and the calldesk default path) is unaffected.

import { calldesk, type ProductConfig, type ScoreVocabularyRule } from '../products';

export interface ScoreInput {
  tier: string | null;
  location: string | null;
  description: string | null;
}

// Evidence gathered by discovery stages beyond the directory/search blurb:
// which additional signal sources fired, and what tech fingerprinting found
// on the lead's own site (which competing platforms it references).
export interface ScoreEvidence {
  viaJobPosting?: boolean;
  viaReviewSite?: boolean;
  techPlatforms?: string[];
}

export interface ScoreResult {
  score: number;
  reasons: string[];
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

export function scoreLead(input: ScoreInput, evidence?: ScoreEvidence, product: ProductConfig = calldesk): ScoreResult {
  const tier = (input.tier || '').toLowerCase();
  const desc = (input.description || '').toLowerCase();
  let score = 50;
  const reasons: string[] = [];

  const add = (delta: number, reason: string) => {
    score += delta;
    reasons.push(`${delta >= 0 ? '+' : ''}${delta}: ${reason}`);
  };

  if (tier.includes('gold')) add(15, 'Retell gold-tier partner');
  else if (tier.includes('elite') || tier.includes('diamond')) add(-10, 'top-tier partner (likely already well-served)');

  for (const rule of product.scoreVocabulary as ScoreVocabularyRule[]) {
    if (rule.pattern.test(desc)) add(rule.delta, rule.reason);
  }

  if (evidence?.viaJobPosting) add(15, 'publicly hiring for a voice-AI role');
  if (evidence?.viaReviewSite) add(10, 'named in a public review as a voice-AI provider');
  for (const platform of evidence?.techPlatforms ?? []) {
    add(20, `confirmed ${platform} integration on their own site`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
