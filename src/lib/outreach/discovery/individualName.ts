// A registry row whose "company" name is just a person ("Jeffrey Kyle Porter", "John W Bonner Iv") is a
// sole proprietor licensed in their own name. In the Virginia DPOR backfill 0 of 189 such leads had a
// findable website, versus ~11% of business-named leads, so spending a web search on them is wasted.
// Deliberately conservative: only 2-4 plain name tokens (optional initial / generational suffix) and NO
// business word, "&", digit or punctuation count as an individual.
const BUSINESS_WORD = /\b(inc|llc|l\.l\.c|corp|corporation|company|co|ltd|incorporated|enterprises?|services?|service|contracting|contractors?|construction|electric|electrical|plumbing|heating|cooling|hvac|mechanical|roofing|builders?|homes?|remodeling|renovations?|restoration|group|associates|solutions|systems|brothers|bros|sons|and|repair|maintenance|installation|design|designs|landscap\w*|paving|masonry|concrete|painting|flooring|carpentry|handyman|home|improvements?|industries|international|partners|properties|developments?|exteriors?|interiors?|centers?|centres?|learning|academy|academies|schools?|pre-?schools?|day ?care|child ?care|child|children'?s?|kids?|kiddie|kiddies|tots|tykes|early|education|educational|montessori|nursery|play ?house|play ?school|kindergarten|care|church|ministry|ministries|club|institute|foundation|village|gardens?|house|place|world|land|station|depot|shop|store|clinic|agency|hospice|health|medical|dental|insurance|realty|properties|tow|towing|transport|logistics|freight|septic|pumping|cleaning)\b/i;
// Generic business-name words that are common in home-care, child-care and trade names but not in the older list above (a plain
// two-word name such as "Visiting Angels", "Head Start" or "Cool Temp" is a business, not a person; a false positive here
// would wrongly pull a real business's phone off callers' lists).
const BUSINESS_WORD_2 = /(?:\b(head ?start|helpers?|angels?|keepers?|collective|hearts?|caring|caregiv\w*|kare|kares|touch|hands?|love|luv|friends?|buddies|seniors?|companions?|companionship|visiting|air|temp|tech|controls?|sheet ?metal|sheetmetal|fix|lp|llp|pllc|pc|university|hospitals?|county|department|dept|pathways|program|programs|clubhouse|hangout|enrichment|after ?school|elementary|cdc|cep|den|lambs?|bees|buttons|playmates?|konnection|little|lil|blessings|dreams|stars?|rainbows?|sunshine|nest|tree|learn|play|playground|nannies|nanny|helping|hand|private|duty|personal|assisted|living|rehab|hospital|therapy|wellness|respite|aide|aides|staffing|nursing|nurses|lifecare|homecare|healthcare|of|the|for|at|to|on|in|investors?|limited|partnership|ventures?|holdings?|capital|trust|fund|llp)\b|\w+care\b)/i;
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function looksLikeIndividual(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n || /[&\d,.@/#]/.test(n.replace(/\b[A-Z]\.(?=\s|$)/g, ''))) return false;
  if (BUSINESS_WORD.test(n) || BUSINESS_WORD_2.test(n)) return false;
  const toks = n.split(/\s+/);
  if (toks.length < 2 || toks.length > 5) return false;
  return toks.every((t) => /^[A-Za-z][A-Za-z'’-]*$/.test(t) && (t.length > 1 || toks.indexOf(t) > 0 || true)) && toks.filter((t) => !SUFFIX.has(t.toLowerCase())).length >= 2;
}
