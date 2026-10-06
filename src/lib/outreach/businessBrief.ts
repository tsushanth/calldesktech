import { politeFetchText } from './discovery/http';

// Reads a vertical lead's OWN website (no LLM, plain fetch + patterns) and picks the pain point most likely to be
// real for that business, from a fixed menu of things Calldesk does today (see the landing page: live-calendar booking
// through Cal.com, transfer or message-taking, outbound reminders, business-hours routing, 55 languages).
//
// Before this, every vertical draft asked the same question ("what happens to calls after hours?") because the only
// facts we had about a lead were registry facts. Now a draft can say one thing that is true of THIS business, taken
// from its site, and ask about the problem that fact points at. When the site shows nothing, the angle is the old
// default and says so (angle 'after_hours', evidence null), so the default is measurable.

export type AngleId = 'after_hours' | 'booking' | 'reminders' | 'transfer' | 'spanish';

export interface SiteSignals {
  onlineBookingTool: string | null; // e.g. 'Calendly', 'Zocdoc'
  callToBook: string | null; // the exact sentence fragment found
  weekdayOnlyHours: string | null; // the hours text found, when weekends are closed
  twentyFourSeven: string | null; // the exact "24/7" style claim
  emergency: boolean;
  spanish: boolean;
  cancellationPolicy: string | null;
}

export interface Angle {
  id: AngleId;
  evidence: string | null; // one fact stated on their own site, quoted as found; null when the angle is the default
  question: string; // what to ask the owner, specific to the angle
  capability: string; // what the Calldesk agent does for this angle, using only what the product does today
}

const BOOKING_TOOLS: [RegExp, string][] = [
  [/calendly\.com/i, 'Calendly'], [/acuityscheduling|squarespacescheduling/i, 'Acuity'], [/zocdoc\.com/i, 'Zocdoc'],
  [/nexhealth/i, 'NexHealth'], [/janeapp\.com/i, 'Jane'], [/mindbodyonline|mindbody\.io/i, 'Mindbody'], [/vagaro\.com/i, 'Vagaro'],
  [/booksy\.com/i, 'Booksy'], [/squareup\.com\/appointments|square\.site/i, 'Square Appointments'], [/cal\.com/i, 'Cal.com'],
  [/localmed|solutionreach|doctible|zenplanner|simplepractice/i, 'an online booking tool'],
  [/book (an )?(appointment )?online|schedule (an )?(appointment )?online|online (booking|scheduling)|request an appointment/i, 'online booking'],
];

function strip(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// Collapses whitespace and cuts at a word boundary, so a quoted fact is never chopped mid-word.
function clean(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim();
}

/** Pure: signals from one or more pages of a business's own site (html strings). */
export function extractSignals(pages: string[]): SiteSignals {
  const html = pages.join('\n');
  const text = strip(html);
  const s: SiteSignals = { onlineBookingTool: null, callToBook: null, weekdayOnlyHours: null, twentyFourSeven: null, emergency: false, spanish: false, cancellationPolicy: null };

  for (const [re, name] of BOOKING_TOOLS) if (re.test(html)) { s.onlineBookingTool = name; break; }

  const call = /call (us |our office |the office )?(today )?(to|for) (schedule|book|make|an appointment|a free (quote|estimate)|your appointment)[^.!?]{0,50}/i.exec(text);
  if (call) s.callToBook = clean(call[0], 70);

  // Weekday hours with weekends closed. Needs a day range AND a closing signal so a plain "Mon-Fri" mention does not count.
  const hours = /(mon(day)?\s*[-–to]+\s*fri(day)?[^.]{0,40}\d[^.]{0,30}(pm|p\.m\.)|(sat(urday)?|sun(day)?)[^.]{0,25}closed|closed[^.]{0,15}(sat|sun|weekend))/i.exec(text);
  if (hours) s.weekdayOnlyHours = clean(hours[0], 80);

  // Every 24/7-style claim on the page; keep the most specific one (nav bars and footers repeat a bare "24/7").
  const claimRe = /(24\s*\/\s*7|24[- ]hours?(?: a day)?(?:,? (?:7|seven) days(?: a week)?)?|open 24(?: hours)?|around the clock|seven days a week)(?:\s+(?:emergency|service|services|towing|roadside|assistance|support|dispatch|bail bonds?|bail|care|repair|plumbing|septic|pumping|answering|available|availability|hotline|line)){0,3}/gi;
  const claims = [...text.matchAll(claimRe)].map((m) => clean(m[0], 60)).sort((a, b) => b.length - a.length);
  if (claims.length) s.twentyFourSeven = claims[0];

  s.emergency = /emergenc(y|ies)|urgent (care|calls?)|same[- ]day/i.test(text);
  s.spanish = /se habla espa(ñ|n)ol|hablamos espa(ñ|n)ol|en espa(ñ|n)ol|\bespa(ñ|n)ol\b/i.test(text) || /<html[^>]*lang=["']?es/i.test(html);

  const canc = /(cancell?ation|no[- ]show|missed appointment)[^.]{0,80}/i.exec(text);
  if (canc) s.cancellationPolicy = clean(canc[0], 100);
  return s;
}

// Which angles make sense per vertical. 'reminders' is deliberately in no list yet: the pilot is "forward your calls" and
// reminder calls are outbound from their appointment list, so it does not fit the offer as written.
// Which angles make sense per vertical. Sensitive verticals never get the angles that imply handling the substance of a
// call (booking or reminders for legal or funeral matters); those stay on answering, transfer and messages.
const ALLOWED: Record<string, AngleId[]> = {
  dental: ['booking', 'after_hours', 'spanish'],
  physio: ['booking', 'after_hours', 'spanish'],
  vets: ['booking', 'transfer', 'after_hours', 'spanish'],
  childcare: ['booking', 'after_hours', 'spanish'],
  homecare: ['after_hours', 'transfer', 'spanish'],
  homeservices: ['transfer', 'booking', 'after_hours', 'spanish'],
  septic: ['transfer', 'after_hours', 'spanish'],
  towing: ['transfer', 'after_hours', 'spanish'],
  taxi: ['transfer', 'after_hours', 'spanish'],
  bailbonds: ['transfer', 'after_hours', 'spanish'],
  insurance: ['after_hours', 'booking', 'spanish'],
  accounting: ['booking', 'after_hours'],
  realestate: ['booking', 'after_hours', 'spanish'],
  lodging: ['after_hours', 'transfer', 'spanish'],
  funeral: ['transfer', 'after_hours'],
  freight: ['after_hours'],
};

// The transfer question, in the words of the vertical (a tow truck is "out on a job"; a bail-bond office is not).
const TRANSFER_Q: Record<string, string> = {
  towing: 'Who picks up when that line rings and your crew is already out on a job?',
  septic: 'Who picks up when that line rings and you are already out on a job?',
  homeservices: 'Who picks up when that line rings and you are already out on a job?',
  bailbonds: 'Who picks up when that line rings in the middle of the night, or while your agent is with another client?',
  homecare: 'Who picks up when that line rings and the office is with a client or out on a visit?',
  taxi: 'Who picks up when that line rings and every dispatcher is already on a call?',
  vets: 'Who picks up when that line rings and the whole team is with patients?',
  lodging: 'Who picks up when that line rings and the front desk is with a guest?',
  funeral: 'Who picks up when that line rings and the director is with a family?',
};
const TRANSFER_DEFAULT_Q = 'Who picks up when that line rings and nobody is free to answer?';

const CAP = {
  after_hours: 'answers, takes the caller\'s name, what they need and a callback number, and you get a summary and transcript of every call',
  booking: 'reads your live Google or Outlook calendar (connected through Cal.com), offers the caller open times and books one during the same call, then texts a confirmation',
  reminders: 'calls clients ahead of their appointment to confirm or reschedule, so empty slots are caught early',
  transfer: 'passes urgent calls to the number you choose and takes a message with name, number and reason for the rest',
  spanish: 'answers in the caller\'s language, including Spanish (Calldesk supports 55 languages on live calls), and you get an English summary',
};

/** Pure: choose the angle for a vertical from the site's signals. Falls back to the default after-hours question. */
export function chooseAngle(verticalId: string, s: SiteSignals): Angle {
  const ok = new Set<AngleId>(ALLOWED[verticalId] ?? ['after_hours']);
  const pick = (id: AngleId, evidence: string, question: string): Angle | null =>
    ok.has(id) ? { id, evidence, question, capability: CAP[id] } : null;

  const candidates: (Angle | null)[] = [
    s.callToBook && !s.onlineBookingTool
      ? pick('booking', `Your site says: "${s.callToBook}"`, 'When the phone is how people book, what happens to the call when the front desk is already on another line?')
      : null,
    s.twentyFourSeven && (s.emergency || verticalId !== 'freight')
      ? pick('transfer', /^24\s*\/\s*7$/.test(s.twentyFourSeven) ? 'Your site advertises 24/7 service' : `Your site says: "${s.twentyFourSeven}"`, TRANSFER_Q[verticalId] ?? TRANSFER_DEFAULT_Q)
      : null,
    s.weekdayOnlyHours
      ? pick('after_hours', `Your site lists: "${s.weekdayOnlyHours}"`, 'What happens to a call that comes in outside those hours?')
      : null,
    s.onlineBookingTool && (s.cancellationPolicy || ['dental', 'physio', 'vets'].includes(verticalId))
      ? pick('reminders', s.cancellationPolicy ? `Your site mentions: "${s.cancellationPolicy}"` : (s.onlineBookingTool === 'online booking' ? 'Your site lets people book online' : `You take bookings online through ${s.onlineBookingTool}`), 'How are you confirming appointments today, so a no-show does not leave an empty slot?')
      : null,
    s.spanish ? pick('spanish', 'Your site is available in Spanish', 'When a caller prefers Spanish and the person who speaks it is busy, what happens to the call?') : null,
  ];
  const chosen = candidates.find((c): c is Angle => !!c);
  if (chosen) return chosen;
  return { id: 'after_hours', evidence: null, question: 'What happens to a call when nobody can pick up, especially after hours?', capability: CAP.after_hours };
}

/** Fetches the homepage and the first contact/about/services page found, and returns the signals. */
export async function fetchSiteSignals(domain: string): Promise<{ signals: SiteSignals; pages: string[] } | null> {
  const home = await politeFetchText(`https://${domain}/`, 12000);
  if (!home.ok || home.text.length < 300) return null;
  const pages = [home.text];
  const links = [...home.text.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const pick = links.find((l) => /(contact|hours|appointment|schedule|about)/i.test(l) && !/^(mailto|tel|javascript):/i.test(l));
  if (pick) {
    try {
      const url = new URL(pick, `https://${domain}/`);
      if (url.hostname.replace(/^www\./, '') === domain.replace(/^www\./, '')) {
        const sub = await politeFetchText(url.toString(), 12000);
        if (sub.ok) pages.push(sub.text);
      }
    } catch { /* bad href: use the homepage alone */ }
  }
  return { signals: extractSignals(pages), pages: [] };
}
