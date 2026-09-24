import { findCandidates, type SourceSpec, type SearchCandidate } from './genericSource';
import { politeFetchText } from './http';

// Web-search discovery for the customer-discovery verticals that have no free
// registry (homeservices, dental, insurance). Same search -> parse -> verify
// loop as every other Claude-web-search source (genericSource.ts): the model
// only PROPOSES candidates; each one is kept only if its own homepage loads and
// reads like that kind of business. Freight uses FMCSA open data instead
// (freightFmcsa.ts). US-only: the prompt asks for a specific US state.

export type { SearchCandidate };
export type SearchVertical = 'homeservices' | 'dental' | 'insurance' | 'bailbonds';

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming',
];

// Largest US metros. State-wide queries keep returning the same top results, so city-level queries
// reach different independent practices.
export const US_METROS = [
  'New York, NY', 'Los Angeles, CA', 'Chicago, IL', 'Houston, TX', 'Phoenix, AZ', 'Philadelphia, PA', 'San Antonio, TX', 'San Diego, CA',
  'Dallas, TX', 'Jacksonville, FL', 'Austin, TX', 'Fort Worth, TX', 'San Jose, CA', 'Columbus, OH', 'Charlotte, NC', 'Indianapolis, IN',
  'San Francisco, CA', 'Seattle, WA', 'Denver, CO', 'Washington, DC', 'Nashville, TN', 'Oklahoma City, OK', 'El Paso, TX', 'Boston, MA',
  'Portland, OR', 'Las Vegas, NV', 'Detroit, MI', 'Memphis, TN', 'Louisville, KY', 'Baltimore, MD', 'Milwaukee, WI', 'Albuquerque, NM',
  'Tucson, AZ', 'Fresno, CA', 'Sacramento, CA', 'Kansas City, MO', 'Atlanta, GA', 'Omaha, NE', 'Colorado Springs, CO', 'Raleigh, NC',
  'Miami, FL', 'Virginia Beach, VA', 'Oakland, CA', 'Minneapolis, MN', 'Tulsa, OK', 'Tampa, FL', 'Arlington, TX', 'New Orleans, LA',
  'Wichita, KS', 'Cleveland, OH', 'Bakersfield, CA', 'Aurora, CO', 'Anaheim, CA', 'Honolulu, HI', 'Santa Ana, CA', 'Riverside, CA',
  'Corpus Christi, TX', 'Lexington, KY', 'Henderson, NV', 'Stockton, CA', 'Saint Paul, MN', 'Cincinnati, OH', 'St. Louis, MO', 'Pittsburgh, PA',
  'Greensboro, NC', 'Lincoln, NE', 'Orlando, FL', 'Irvine, CA', 'Newark, NJ', 'Durham, NC', 'Chula Vista, CA', 'Toledo, OH',
  'Fort Wayne, IN', 'St. Petersburg, FL', 'Laredo, TX', 'Jersey City, NJ', 'Chandler, AZ', 'Madison, WI', 'Lubbock, TX', 'Scottsdale, AZ',
  'Reno, NV', 'Buffalo, NY', 'Gilbert, AZ', 'Glendale, AZ', 'Winston-Salem, NC', 'Chesapeake, VA', 'Norfolk, VA', 'Fremont, CA',
  'Garland, TX', 'Irving, TX', 'Hialeah, FL', 'Richmond, VA', 'Boise, ID', 'Spokane, WA', 'Baton Rouge, LA', 'Des Moines, IA',
];

interface VerticalSearchDef {
  // Query locations; defaults to the US states. City-level lists reach different practices than state-wide ones.
  places?: string[];
  phrasings: string[]; // "<phrasing> in <state>"
  describe: string; // what to look for, used in the prompt
  exclude: string; // what not to return, used in the prompt
  hostExclusions: string[];
  // The homepage text must match this to be kept.
  looksLike: RegExp;
  // If the homepage matches this, it is an aggregator/lead-gen page, not a bail agency's own site.
  rejectIf?: RegExp;
  // States skipped in the query rotation (no such businesses to find there).
  excludeStates?: string[];
}

// Directories, lead-gen marketplaces, and national brands. Anything a search
// engine returns from these hosts is not a small business's own site.
export const DIRECTORY_HOSTS = ['angi.com', 'angieslist.com', 'homeadvisor.com', 'thumbtack.com', 'bbb.org', 'yellowpages.com', 'manta.com', 'mapquest.com', 'houzz.com', 'nextdoor.com', 'porch.com', 'fixr.com', 'expertise.com', 'buildzoom.com', 'superpages.com', 'zocdoc.com', 'healthgrades.com', 'webmd.com', 'ada.org', 'opencare.com', 'yext.com', 'birdeye.com', 'indeed.com', 'glassdoor.com', 'forbes.com', 'nerdwallet.com'];

export const VERTICAL_SEARCH: Record<SearchVertical, VerticalSearchDef> = {
  homeservices: {
    phrasings: ['locally owned HVAC company', 'family owned plumbing company', 'independent electrical contractor', 'local roofing contractor', 'small heating and air conditioning company'],
    describe: 'small, locally owned HVAC, plumbing, electrical, or roofing companies (roughly 2-40 employees) that take service calls by phone',
    exclude: 'franchises and national brands (Roto-Rooter, ARS, Mister Sparky, One Hour, Lennox, etc.), lead-generation marketplaces (Angi, HomeAdvisor, Thumbtack), and directories',
    hostExclusions: [...DIRECTORY_HOSTS, 'rotorooter.com', 'onehourheatandair.com', 'mistersparky.com', 'benjaminfranklinplumbing.com', 'aptivepestcontrol.com', 'lennox.com', 'carrier.com', 'trane.com', 'homedepot.com', 'lowes.com', 'sears.com'],
    looksLike: /(hvac|heating|air conditioning|furnace|plumb|drain|water heater|electrician|electrical|roof(ing|er)|contractor)/i,
  },
  dental: {
    places: US_METROS,
    phrasings: ['independent family dental practice', 'general dentistry practice accepting new patients', 'local dentist office', 'small orthodontic or cosmetic dental practice', 'pediatric dentist office', 'cosmetic and implant dentist', 'emergency dentist', 'family dentist with own website'],
    describe: 'independent, privately owned dental practices (one to a few locations) with their own website',
    exclude: 'DSOs and corporate dental chains (Aspen Dental, Heartland Dental, Pacific Dental, Western Dental, Smile Brands, etc.), dental directories, and review sites',
    hostExclusions: [...DIRECTORY_HOSTS, 'aspendental.com', 'heartlanddental.com', 'pacificdentalservices.com', 'westerndental.com', 'smilebrands.com', 'monarchdental.com', 'clearchoice.com', 'affordabledentures.com', 'sonrava.com', 'deltadental.com'],
    looksLike: /(dentist|dental|orthodont|teeth|oral health|periodont)/i,
  },
  insurance: {
    phrasings: ['independent insurance agency', 'local independent insurance agent personal and commercial lines', 'family owned insurance agency', 'small independent insurance brokerage'],
    describe: 'small independent insurance agencies (one office or a few, roughly 2-30 staff) selling personal and/or commercial lines from several carriers',
    exclude: 'captive agents of a single carrier (State Farm, Allstate, Farmers, GEICO, American Family, Liberty Mutual), national brokerages (Marsh, Aon, Gallagher, Brown & Brown, USI), lead aggregators and comparison sites, and directories',
    hostExclusions: [...DIRECTORY_HOSTS, 'statefarm.com', 'allstate.com', 'farmers.com', 'geico.com', 'progressive.com', 'libertymutual.com', 'amfam.com', 'nationwide.com', 'usaa.com', 'marsh.com', 'aon.com', 'ajg.com', 'bbrown.com', 'usi.com', 'policygenius.com', 'thezebra.com', 'insurify.com', 'trustedchoice.com', 'iia.org', 'naic.org'],
    looksLike: /insurance/i,
  },
  bailbonds: {
    phrasings: ['bail bonds agency', 'licensed bail bondsman', 'local bail bonds company 24 hour', 'family owned bail bonds'],
    describe: 'small, licensed, locally owned bail bond agencies (one office or a few) with their own website that take calls around the clock',
    exclude: 'bail-bond directories, lead-generation and "find a bondsman in your state" sites, national networks and franchises, law firms, court/government pages, and news sites',
    hostExclusions: [
      ...DIRECTORY_HOSTS, 'bail.com', 'bailbonds.com', 'bailbondsnetwork.com', 'bailbondsfinder.com', 'bailbondsdirect.com', 'bailbondsnearme.com', 'usbailbonds.com',
      'freebailbondsnearme.com', 'pbus.org', 'bailagents.org', 'justia.com', 'findlaw.com', 'nolo.com', 'avvo.com', 'lawyers.com', 'legalzoom.com', 'inmateaid.com',
      'vinelink.com', 'jailbase.com', 'mugshots.com', 'arrests.org', 'bustedmugshots.com', 'usa.gov', 'wikipedia.org',
    ],
    // Commercial bail bonding is prohibited in these states (a search there only returns noise).
    excludeStates: ['Illinois', 'Kentucky', 'Nebraska', 'Oregon', 'Wisconsin'],
    looksLike: /bail\s*bond/i,
    rejectIf: /(find|search)\s+(a\s+)?bail\s*(bonds?|bondsm[ae]n|agents?)\s+(in|by|near)\s+(your|any)|bail\s*bonds?\s+(in\s+all\s+50\s+states|nationwide\s+network)|(we|our\s+network)\s+(will\s+)?connect(s)?\s+you\s+(with|to)\s+(a\s+)?(local\s+)?(bail|licensed)|mugshots?\s+(search|database|gallery)|inmate\s+(search|lookup)\s+by\s+state/i,
  },
};

// Slot-keyed (not day-keyed) rotation through phrasing x state, so repeated
// runs within a day advance instead of repeating (same idea as searchSource.ts).
const SLOT_MS = 2 * 60 * 60_000;
export function verticalQueries(vertical: SearchVertical, now = new Date(), perDay = 2): string[] {
  const def = VERTICAL_SEARCH[vertical];
  const places = def.places ?? US_STATES.filter((st) => !def.excludeStates?.includes(st));
  const combos = places.flatMap((pl) => def.phrasings.map((p) => `${p} in ${pl}`));
  const slot = Math.floor(now.getTime() / SLOT_MS);
  return Array.from({ length: perDay }, (_, i) => combos[(slot * perDay + i) % combos.length]);
}

export function looksLikeVertical(vertical: SearchVertical, html: string): boolean {
  return VERTICAL_SEARCH[vertical].looksLike.test(html.slice(0, 200_000));
}

function promptFor(vertical: SearchVertical, query: string): string {
  const d = VERTICAL_SEARCH[vertical];
  return `Search the web for: ${query}

I want ${d.describe}. Exclude ${d.exclude}. Only businesses located in the United States.

Return ONLY a JSON array (at most 10 items) of objects with keys: name, website (the business's own homepage URL, taken from the search results), location (city and state if shown, else null), blurb (one factual sentence taken from their own site or listing; do not embellish). Only include businesses you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;
}

function specFor(vertical: SearchVertical): SourceSpec {
  return {
    signalSource: 'search',
    queriesForDay: (now, perDay) => verticalQueries(vertical, now, perDay),
    promptFor: (q) => promptFor(vertical, q),
    hostExclusions: VERTICAL_SEARCH[vertical].hostExclusions,
    verify: async (domain) => {
      const res = await politeFetchText(`https://${domain}`, 12000);
      if (!res.ok || res.text.length < 500) return false;
      if (!looksLikeVertical(vertical, res.text)) return false;
      const rej = VERTICAL_SEARCH[vertical].rejectIf;
      return !(rej && rej.test(res.text.slice(0, 200_000)));
    },
  };
}

export async function findVerticalSearchCandidates(vertical: SearchVertical, perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(specFor(vertical), perDay, shouldStop);
}
