// A registry row whose "company" name is just a person ("Jeffrey Kyle Porter", "John W Bonner Iv") is a
// sole proprietor licensed in their own name. In the Virginia DPOR backfill 0 of 189 such leads had a
// findable website, versus ~11% of business-named leads, so spending a web search on them is wasted.
// Deliberately conservative: only 2-4 plain name tokens (optional initial / generational suffix) and NO
// business word, "&", digit or punctuation count as an individual.
const BUSINESS_WORD = /\b(inc|llc|l\.l\.c|corp|corporation|company|co|ltd|incorporated|enterprises?|services?|service|contracting|contractors?|construction|electric|electrical|plumbing|heating|cooling|hvac|mechanical|roofing|builders?|homes?|remodeling|renovations?|restoration|group|associates|solutions|systems|brothers|bros|sons|and|repair|maintenance|installation|design|designs|landscap\w*|paving|masonry|concrete|painting|flooring|carpentry|handyman|home|improvements?|industries|international|partners|properties|developments?|exteriors?|interiors?)\b/i;
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function looksLikeIndividual(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n || /[&\d,.@/#]/.test(n.replace(/\b[A-Z]\.(?=\s|$)/g, ''))) return false;
  if (BUSINESS_WORD.test(n)) return false;
  const toks = n.split(/\s+/);
  if (toks.length < 2 || toks.length > 5) return false;
  return toks.every((t) => /^[A-Za-z][A-Za-z'’-]*$/.test(t) && (t.length > 1 || toks.indexOf(t) > 0 || true)) && toks.filter((t) => !SUFFIX.has(t.toLowerCase())).length >= 2;
}
