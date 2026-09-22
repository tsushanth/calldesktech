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
const COUNTRY_LANGUAGE: [RegExp, LanguageMatch][] = [
  [/\bspain\b|\bméxico\b|\bmexico\b|\bcolombia\b|\bargentina\b|\bchile\b|\bperu\b|\bperú\b|\bpanam[áa]\b|\becuador\b|\buruguay\b|\bvenezuela\b|\bcosta rica\b|\bguatemala\b|\bbolivia\b|\bparaguay\b|\bdominican republic\b|\bhonduras\b|\bel salvador\b|\bnicaragua\b/i, { code: 'es', name: 'Spanish' }],
  [/\bfrance\b|\bbelgium\b|\bmorocco\b|\btunisia\b|\bsenegal\b|\bivory coast\b|\bc[oô]te d'ivoire\b/i, { code: 'fr', name: 'French' }],
  [/\bbrazil\b|\bbrasil\b|\bportugal\b/i, { code: 'pt', name: 'Portuguese' }],
  [/\bitaly\b|\bitalia\b/i, { code: 'it', name: 'Italian' }],
  [/\bnetherlands\b|\bholland\b/i, { code: 'nl', name: 'Dutch' }],
  [/\bpoland\b|\bpolska\b/i, { code: 'pl', name: 'Polish' }],
  [/\bsweden\b|\bsverige\b/i, { code: 'sv', name: 'Swedish' }],
  [/\bindonesia\b/i, { code: 'id', name: 'Indonesian' }],
  [/\bturkey\b|\bt[üu]rkiye\b/i, { code: 'tr', name: 'Turkish' }],
  [/\bvietnam\b|\bviệt nam\b/i, { code: 'vi', name: 'Vietnamese' }],
  [/\bthailand\b/i, { code: 'th', name: 'Thai' }],
  [/\bjapan\b/i, { code: 'ja', name: 'Japanese' }],
  [/\bsouth korea\b|\brepublic of korea\b/i, { code: 'ko', name: 'Korean' }],
];

// Regions excluded from ANY outreach at all (see score.ts) also shouldn't
// get a native-language draft even if matched above by coincidence — but
// isRegionBlocked is checked separately upstream, so this function only
// needs to worry about language, not region eligibility.
export function detectDraftLanguage(location: string | null): LanguageMatch | null {
  if (!location) return null;
  for (const [pattern, lang] of COUNTRY_LANGUAGE) {
    if (pattern.test(location)) return lang;
  }
  return null;
}
