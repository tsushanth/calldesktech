// Banned wording. Comparison pages make claims about other companies, so they avoid superlatives, disparagement and promises that
// cannot be verified. The check runs on the rendered text of every competitor-facing page (compare, alternatives, migrate), which
// includes the researchers' wording from the competitor JSON, so a researcher's "best" fails the build the same way ours would.
//
// Matching is whole-word and case-insensitive. A word that is part of a company or product name is allowed by passing it in `allowNames`.

export const SUPERLATIVES = [
  'best', 'worst', 'unbeatable', 'only', 'cheapest', 'cheaper', 'fastest', 'leading', 'leader', 'number one', 'top-rated', 'top-tier', 'ultimate',
  'perfect', 'flawless', 'unmatched', 'unrivaled', 'unrivalled', 'superior', 'revolutionary', 'game-changing', 'world-class', 'industry-leading',
  'market-leading', 'best-in-class', 'second to none', 'no competition',
];
export const DISPARAGING = [
  'terrible', 'awful', 'horrible', 'bad', 'poor', 'poorly', 'garbage', 'trash', 'junk', 'scam', 'sucks', 'rip-off', 'ripoff', 'overpriced',
  'useless', 'worthless', 'inferior', 'clunky', 'buggy', 'unreliable', 'shady', 'misleading', 'deceptive', 'fraud', 'fraudulent', 'lies', 'lying',
  'beware', 'avoid',
];
export const UNVERIFIABLE = [
  'guaranteed', 'guarantee', 'guarantees', 'always', 'never', '100%', 'risk-free', 'zero risk', 'instantly', 'no-brainer', 'seamless', 'effortless',
  'foolproof', 'bulletproof', 'unlimited',
];

/** Competitor-facing pages: everything above. */
export const BANNED_STRICT: readonly string[] = [...SUPERLATIVES, ...DISPARAGING, ...UNVERIFIABLE];
/** Industry and use-case pages: promises and absolute claims only ("best practice" is ordinary English there). */
export const BANNED_LITE: readonly string[] = [
  'unbeatable', 'worst', 'guaranteed', 'guarantee', 'guarantees', 'risk-free', 'zero risk', '100%', 'no-brainer', 'world-class', 'industry-leading', 'market-leading',
  'best-in-class', 'cheapest', 'number one', 'foolproof', 'bulletproof', 'flawless', 'perfect',
];

// Phrases that contain a banned word but are exact, verifiable facts stated by the product. Removed before matching.
// "Perfect Venue" is the name of a venue-booking product that Slang AI integrates with, not an adjective.
const EXEMPT_PHRASES = [/english[- ]only/gi, /perfect venue/gi];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type BannedHit = { term: string; context: string };

export function findBanned(text: string, banned: readonly string[], allowNames: string[] = []): BannedHit[] {
  let t = text;
  for (const re of EXEMPT_PHRASES) t = t.replace(re, ' ');
  for (const n of allowNames) if (n) t = t.replace(new RegExp(escapeRe(n), 'gi'), ' ');
  const hits: BannedHit[] = [];
  for (const term of banned) {
    // \b does not work next to %, so test the edges by hand.
    const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(term)}(?![A-Za-z0-9_])`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const start = Math.max(0, m.index - 30);
      hits.push({ term, context: t.slice(start, m.index + m[0].length + 30).replace(/\s+/g, ' ').trim() });
    }
  }
  return hits;
}
