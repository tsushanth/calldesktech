// Maps a lead's location string to a language worth drafting the outreach
// email in natively, instead of English. Deliberately conservative: only
// languages Claude writes fluently AND that are common enough among leads to
// be worth the extra review burden. Everything else (including English-
// speaking markets like India/UAE/Singapore, where the agency's own site and
// business language is English) stays in English — that's the existing,
// correct default, not a gap.
//
// Calldesk itself now supports 55 languages on real calls (STT+LLM+TTS+turn-
// taking all verified) — this list is about which OUTREACH EMAIL language
// reads as genuinely native to the recipient, a narrower, more conservative
// set than the full call-language list.

export interface LanguageMatch {
  code: string;
  name: string; // used in the prompt, e.g. "Spanish"
}

// Ordered by how much lead volume each has shown historically; extend freely
// as more countries turn up qualified leads.
// `null` means "English, deliberately" — spelled out for the same reason as in
// COUNTRY_CODE_LANGUAGE below: an English-speaking market should be a decision
// on the record, not a gap that fell through.
const COUNTRY_LANGUAGE: [RegExp, LanguageMatch | null][] = [
  // Quebec is francophone Canada, and its own French: the register and
  // vocabulary differ enough from France's that a France-French draft reads as
  // foreign. Listed FIRST so it wins over the France pattern below. The rest of
  // Canada stays English, which is the default.
  [/\bqu[ée]bec\b|\bmontr[ée]al\b|\bgatineau\b|\bsherbrooke\b|\btrois-rivi[èe]res\b/i, { code: 'fr-CA', name: 'Canadian French' }],
  // Estonia: business email there is routinely in English, and nobody here can
  // review Estonian, so English is the deliberate choice rather than an omission.
  [/\bestonia\b|\beesti\b|\btallinn\b/i, null],
  // Singapore: English is an official and the normal business language.
  [/\bsingapore\b/i, null],
  [/\bspain\b|\bméxico\b|\bmexico\b|\bcolombia\b|\bargentina\b|\bchile\b|\bperu\b|\bperú\b|\bpanam[áa]\b|\becuador\b|\buruguay\b|\bvenezuela\b|\bcosta rica\b|\bguatemala\b|\bbolivia\b|\bparaguay\b|\bdominican republic\b|\bhonduras\b|\bel salvador\b|\bnicaragua\b/i, { code: 'es', name: 'Spanish' }],
  [/\bfrance\b|\bbelgium\b|\bmorocco\b|\btunisia\b|\bsenegal\b|\bivory coast\b|\bc[oô]te d'ivoire\b/i, { code: 'fr', name: 'French' }],
  [/\bbrazil\b|\bbrasil\b|\bportugal\b/i, { code: 'pt', name: 'Portuguese' }],
  [/\bitaly\b|\bitalia\b/i, { code: 'it', name: 'Italian' }],
  [/\bnetherlands\b|\bholland\b/i, { code: 'nl', name: 'Dutch' }],
  [/\bpoland\b|\bpolska\b/i, { code: 'pl', name: 'Polish' }],
  [/\bsweden\b|\bsverige\b/i, { code: 'sv', name: 'Swedish' }],
  [/\bnorway\b|\bnorge\b/i, { code: 'no', name: 'Norwegian' }],
  [/\bindonesia\b/i, { code: 'id', name: 'Indonesian' }],
  [/\bturkey\b|\bt[üu]rkiye\b/i, { code: 'tr', name: 'Turkish' }],
  [/\bvietnam\b|\bviệt nam\b/i, { code: 'vi', name: 'Vietnamese' }],
  [/\bthailand\b/i, { code: 'th', name: 'Thai' }],
  [/\bjapan\b/i, { code: 'ja', name: 'Japanese' }],
  [/\bsouth korea\b|\brepublic of korea\b/i, { code: 'ko', name: 'Korean' }],
];

// The international registry sources write a lead's location as "<City>, <ISO
// country code>" — "Lyon, FR", "Bergen, NO", "London, GB" — the same shape the US
// sources use for "<City>, <state>", so no country NAME appears and the patterns
// above never fire. This maps the trailing code instead.
//
// `null` means "English, the default", stated explicitly so an English-speaking
// market is a deliberate entry rather than a gap.
//
// Every code here must be one that is NOT also a US state code, or a domestic
// lead would be mistaken for a foreign one. DE would be Delaware, IN Indiana, and
// so on; none of those is listed (and DE/AT/CH can never be released anyway —
// see registryCommon.NEVER_RELEASE_COUNTRIES).
const COUNTRY_CODE_LANGUAGE: Record<string, LanguageMatch | null> = {
  FR: { code: 'fr', name: 'French' },
  BE: { code: 'fr', name: 'French' },
  NO: { code: 'no', name: 'Norwegian' },
  GB: null, // United Kingdom — English
  IE: null, // Ireland — English
  BR: { code: 'pt', name: 'Portuguese' },
  MX: { code: 'es', name: 'Spanish' },
  // Quebec's provincial code. Safe to list: QC is not a US state code, and
  // "CA" deliberately is NOT listed here because it would capture California.
  QC: { code: 'fr-CA', name: 'Canadian French' },
  EE: null, // Estonia — English (see COUNTRY_LANGUAGE)
  SG: null, // Singapore — English
};

// Regions excluded from ANY outreach at all (see score.ts) also shouldn't
// get a native-language draft even if matched above by coincidence — but
// isRegionBlocked is checked separately upstream, so this function only
// needs to worry about language, not region eligibility.
export function detectDraftLanguage(location: string | null): LanguageMatch | null {
  if (!location) return null;
  // An explicit country code is more reliable than a name match, so it wins.
  const code = /,\s*([A-Za-z]{2})\s*$/.exec(location)?.[1].toUpperCase();
  if (code && Object.prototype.hasOwnProperty.call(COUNTRY_CODE_LANGUAGE, code)) return COUNTRY_CODE_LANGUAGE[code];
  for (const [pattern, lang] of COUNTRY_LANGUAGE) {
    if (pattern.test(location)) return lang;
  }
  return null;
}
