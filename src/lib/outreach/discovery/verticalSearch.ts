import { findCandidates, type SourceSpec, type SearchCandidate } from './genericSource';
import { politeFetchText } from './http';

// Web-search discovery for the customer-discovery verticals that have no free
// registry (homeservices, dental, insurance). Same search -> parse -> verify
// loop as every other Claude-web-search source (genericSource.ts): the model
// only PROPOSES candidates; each one is kept only if its own homepage loads and
// reads like that kind of business. Freight uses FMCSA open data instead
// (freightFmcsa.ts). US-only: the prompt asks for a specific US state.

export type { SearchCandidate };
export type SearchVertical = 'homeservices' | 'dental' | 'insurance';

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming',
];

interface VerticalSearchDef {
  phrasings: string[]; // "<phrasing> in <state>"
  describe: string; // what to look for, used in the prompt
  exclude: string; // what not to return, used in the prompt
  hostExclusions: string[];
  // The homepage text must match this to be kept.
  looksLike: RegExp;
}

// Directories, lead-gen marketplaces, and national brands. Anything a search
// engine returns from these hosts is not a small business's own site.
const DIRECTORY_HOSTS = ['angi.com', 'angieslist.com', 'homeadvisor.com', 'thumbtack.com', 'bbb.org', 'yellowpages.com', 'manta.com', 'mapquest.com', 'houzz.com', 'nextdoor.com', 'porch.com', 'fixr.com', 'expertise.com', 'buildzoom.com', 'superpages.com', 'zocdoc.com', 'healthgrades.com', 'webmd.com', 'ada.org', 'opencare.com', 'yext.com', 'birdeye.com', 'indeed.com', 'glassdoor.com', 'forbes.com', 'nerdwallet.com'];

export const VERTICAL_SEARCH: Record<SearchVertical, VerticalSearchDef> = {
  homeservices: {
    phrasings: ['locally owned HVAC company', 'family owned plumbing company', 'independent electrical contractor', 'local roofing contractor', 'small heating and air conditioning company'],
    describe: 'small, locally owned HVAC, plumbing, electrical, or roofing companies (roughly 2-40 employees) that take service calls by phone',
    exclude: 'franchises and national brands (Roto-Rooter, ARS, Mister Sparky, One Hour, Lennox, etc.), lead-generation marketplaces (Angi, HomeAdvisor, Thumbtack), and directories',
    hostExclusions: [...DIRECTORY_HOSTS, 'rotorooter.com', 'onehourheatandair.com', 'mistersparky.com', 'benjaminfranklinplumbing.com', 'aptivepestcontrol.com', 'lennox.com', 'carrier.com', 'trane.com', 'homedepot.com', 'lowes.com', 'sears.com'],
    looksLike: /(hvac|heating|air conditioning|furnace|plumb|drain|water heater|electrician|electrical|roof(ing|er)|contractor)/i,
  },
  dental: {
    phrasings: ['independent family dental practice', 'general dentistry practice accepting new patients', 'local dentist office', 'small orthodontic or cosmetic dental practice'],
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
};

// Slot-keyed (not day-keyed) rotation through phrasing x state, so repeated
// runs within a day advance instead of repeating (same idea as searchSource.ts).
const SLOT_MS = 2 * 60 * 60_000;
export function verticalQueries(vertical: SearchVertical, now = new Date(), perDay = 2): string[] {
  const def = VERTICAL_SEARCH[vertical];
  const combos = US_STATES.flatMap((st) => def.phrasings.map((p) => `${p} in ${st}`));
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
      return looksLikeVertical(vertical, res.text);
    },
  };
}

export async function findVerticalSearchCandidates(vertical: SearchVertical, perDay: number, shouldStop: () => boolean = () => false) {
  return findCandidates(specFor(vertical), perDay, shouldStop);
}
