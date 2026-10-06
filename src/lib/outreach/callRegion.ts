import { politeFetchText } from './discovery/http';
import { stateFromPhone } from '../areaCodeState';

// Decides whether a reseller lead's PHONE NUMBER can be dialed by the cold callers, from the lead's own website. Where the
// business is based does not matter (an agency abroad can serve US clients); what matters is whether the stored number is a
// real +1 number, and whether the business plausibly serves the US or Canada. The verdict is stored on the lead at
// signals.callRegion and the call-batch builder only places a lead by its area code when the verdict is one of the callable ones.
//
//   us_confirmed / ca_confirmed  the lead's own number appears on its site as a +1 number
//   us_likely    / ca_likely     English site with US (or Canadian) signals: USD prices, state names, "United States"
//   foreign_number               its site shows the same digits under another country code (a foreign mobile stored bare)
//   bad_number                   the same number is on three or more unrelated leads (a scrape artifact)
//   unclear                      nothing on the homepage and contact pages points at North America
//
// Why not just trust the number's shape: a ten-digit foreign mobile stored without its country code looks exactly like a US
// number (an Indian 7816042887 reads as Massachusetts), and the carrier lookup would say it is valid, belonging to a stranger.

export type RegionVerdict = 'us_confirmed' | 'ca_confirmed' | 'us_likely' | 'ca_likely' | 'foreign_number' | 'bad_number' | 'unclear';
export interface RegionResult { verdict: RegionVerdict; evidence: string }

export const CALLABLE_VERDICTS: RegionVerdict[] = ['us_confirmed', 'ca_confirmed', 'us_likely', 'ca_likely'];

const digits = (s: string) => s.replace(/\D/g, '');
const last10 = (s: string) => digits(s).slice(-10);
const CA_PROVINCES = new Set(['ON', 'QC', 'BC', 'AB', 'SK', 'MB', 'NS', 'NB', 'PE', 'NL']);

const US_RE = /\b(united states|u\.s\.a?\.?|usa|across the us|nationwide|all 50 states|american (businesses|companies|clients))\b/gi;
const STATE_RE = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/gi;
const CAN_RE = /\b(canada|canadian|ontario|quebec|british columbia|alberta|toronto|vancouver|calgary|montreal)\b/gi;

function strip(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

export interface SiteFacts { text: string; lang: string; phones: string[] }

export function factsFromPages(pages: string[]): SiteFacts {
  const html = pages.join(' ');
  const text = strip(html);
  const lang = (/<html[^>]*\blang=["']?([a-zA-Z-]+)/i.exec(pages[0] ?? '') || [])[1] || '';
  const phones = [...new Set((text.match(/\+\d{1,3}[\s().-]*\d[\d\s().-]{6,14}/g) || []).map((p) => p.replace(/\s+/g, ' ').trim()))];
  return { text, lang, phones };
}

/** Pure. `sharedAcrossDomains` is how many different domains in our leads carry this same number. */
export function classifyRegion(site: SiteFacts, lead: { phone: string; location?: string | null }, sharedAcrossDomains = 1): RegionResult {
  if (sharedAcrossDomains >= 3) return { verdict: 'bad_number', evidence: `the same number is on ${sharedAcrossDomains} unrelated leads (scrape artifact)` };

  const mine = last10(lead.phone);
  const onPage = site.phones.find((p) => mine.length === 10 && last10(p) === mine && digits(p).length >= 10);
  if (onPage) {
    const plus1 = /^\+\s*1\b/.test(onPage) || /^\+1[\s(.-]?\d/.test(onPage);
    if (!plus1) return { verdict: 'foreign_number', evidence: `its site shows this number as ${onPage}, a non-+1 number` };
    const state = stateFromPhone(lead.phone);
    return { verdict: state && CA_PROVINCES.has(state) ? 'ca_confirmed' : 'us_confirmed', evidence: `lead number shown on its site as ${onPage}` };
  }

  const count = (re: RegExp) => (site.text.match(re) || []).length;
  const us = count(US_RE), states = count(STATE_RE), can = count(CAN_RE);
  const usd = (site.text.match(/\$\s?\d/g) || []).length;
  const english = !site.lang || /^en/i.test(site.lang);
  const loc = String(lead.location ?? '');
  if (can >= 3 && can > us + states) return { verdict: 'ca_likely', evidence: `Canadian mentions on the site (${can})` };
  if (us > 0 || states > 0 || /united states|usa/i.test(loc) || (english && usd >= 5)) {
    return { verdict: 'us_likely', evidence: `US signals on the site (US mentions ${us}, state names ${states}, USD prices ${usd})` };
  }
  return { verdict: 'unclear', evidence: 'nothing on the home, about and contact pages points at the US or Canada' };
}

const PATHS = ['/about', '/about-us', '/contact', '/contact-us', '/pricing', '/company'];

/** Fetches the homepage plus a few likely pages (plain HTTP, 12s each). Null when the site cannot be reached. */
export async function fetchSiteFacts(domain: string): Promise<SiteFacts | null> {
  let base = `https://${domain}`;
  let home = await politeFetchText(`${base}/`, 12000);
  if (!home.ok) { base = `https://www.${domain}`; home = await politeFetchText(`${base}/`, 12000); }
  if (!home.ok || home.text.length < 200) return null;
  const pages = [home.text];
  const rest = await Promise.all(PATHS.map((p) => politeFetchText(`${base}${p}`, 10000)));
  for (const r of rest) if (r.ok) pages.push(r.text);
  return factsFromPages(pages);
}
