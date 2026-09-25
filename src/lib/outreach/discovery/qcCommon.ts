// Shared constants for the QUÉBEC sources (child care, tourism accommodation and,
// if it is ever built, the RBQ contractor licences). Kept in one place so the
// country code, the province code that drives the draft language, and the CC-BY
// attribution string cannot drift apart between them.

// ISO-3166 country. Québec leads are CANADIAN leads: this is what the
// international hold records and what `COUNTRY=CA tsx release-country.ts` releases.
// It is deliberately NOT "QC", which is not a country.
export const QC_COUNTRY = 'CA';

// The province code written into the lead's `location` as "<City>, QC". That code
// is what language.detectDraftLanguage maps to CANADIAN French (fr-CA) rather than
// France French, and it is safe to use because QC is not a US state code — "CA"
// deliberately is not in that map, because it would capture California.
export const QC_STATE = 'QC';

// Every donneesquebec.ca dataset used here is published under the Creative Commons
// Attribution 4.0 International licence, which REQUIRES attribution on reuse. The
// attribution is recorded on every lead (signals.registry via signalDetail), so the
// obligation travels with the data instead of living only in a comment here.
export const QC_LICENCE = 'CC-BY 4.0';

export function QC_ATTRIBUTION(registryName: string): string {
  return `source ${registryName}, donneesquebec.ca, licence ${QC_LICENCE}`;
}
