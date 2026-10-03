// Investor deck for Calldesk. Same 1920x1080 HTML-slide format and look as the customer deck (slides.ts).
//
// Every number on a slide is either (a) a vendor's published list price retrieved on PRICING_AS_OF, (b) a figure
// about the product, or (c) arithmetic on those, with the assumption stated on the slide. Nothing here is a
// traction claim: the pitch is the competitive position and the plan, not customers or revenue.
//
// Anything the founders must still supply is marked with TODO(...) so the page refuses to serve in production
// until it is filled in (see investorDeckTodos and the /investors page).
import { DECK_FONTS_HREF } from './slides';
import { LIVE_RANGE_WORDS, PRO_CENTS, STANDARD_CENTS, LITE_CENTS, twoMinuteCallRange } from '@/lib/pricingCopy';

export { DECK_FONTS_HREF };
export const PRICING_AS_OF = 'October 1, 2026';

const NAVY = '#0F1B2D';
const LIGHT = '#F2F5F9';
const AMBER = '#FFB547';
const CARD = '#FBFCFE';
const LINE = '#D5DDE9';
const MUTED = '#3A4763';
const MUTED_DARK = '#B7C3D9';
const HEAD = "font-family:'Bricolage Grotesque', Arial, sans-serif";
const BODY = "font-family:'Public Sans', Arial, sans-serif";

let page = 0;
const footer = (dark: boolean) => `<div style="position:absolute; left:128px; right:128px; bottom:56px; display:flex; justify-content:space-between; font-size:24px; color:${dark ? MUTED_DARK : MUTED}"><span>Calldesk &middot; calldesk.tech &middot; Confidential</span><span>${++page}</span></div>`;

function section(id: string, dark: boolean, inner: string, bg?: string): string {
  const bgc = bg ?? (dark ? NAVY : LIGHT);
  const fg = bg === AMBER ? NAVY : dark ? '#EEF2F8' : NAVY;
  return `<section id="${id}" data-transition="fade" style="position:relative; background:${bgc}; color:${fg}; ${BODY}; padding:112px 128px 160px; display:flex; flex-direction:column; gap:52px">${inner}${footer(dark && bg !== AMBER)}</section>`;
}
const h2 = (t: string, dark: boolean) => `<h2 style="${HEAD}; font-size:68px; font-weight:700; line-height:1.05; color:${dark ? '#EEF2F8' : NAVY}">${t}</h2>`;
const p = (t: string, dark: boolean, size = 36) => `<p style="font-size:${size}px; line-height:1.38; color:${dark ? MUTED_DARK : MUTED}">${t}</p>`;
const note = (t: string, dark: boolean) => `<p style="font-size:25px; line-height:1.35; color:${dark ? MUTED_DARK : MUTED}">${t}</p>`;
function card(title: string, body: string, dark: boolean, flex = 1, compact = false): string {
  const bg = dark ? '#16253B' : CARD; const bd = dark ? '#2A3C58' : LINE;
  const pad = compact ? 30 : 44; const ts = compact ? 38 : 48; const bs = compact ? 30 : 34;
  return `<div style="flex:${flex}; display:flex; flex-direction:column; gap:16px; background:${bg}; border:1px solid ${bd}; border-radius:20px; padding:${pad}px"><h3 style="${HEAD}; font-size:${ts}px; font-weight:700; line-height:1.1; color:${dark ? '#EEF2F8' : NAVY}">${title}</h3><p style="font-size:${bs}px; line-height:1.35; color:${dark ? MUTED_DARK : MUTED}">${body}</p></div>`;
}
const row = (cards: string[]) => `<div style="display:flex; gap:28px">${cards.join('')}</div>`;

// Horizontal range bar on a 0 - $0.32 per-minute scale.
const SCALE_MAX = 0.32;
function bar(label: string, lo: number, hi: number | null, detail: string, color: string): string {
  const w = 1000; const left = Math.round((lo / SCALE_MAX) * w); const right = Math.round(((hi ?? lo) / SCALE_MAX) * w);
  const width = Math.max(14, right - left);
  return `<div style="display:flex; align-items:center; gap:24px"><div style="width:350px; font-size:34px; font-weight:600; color:${NAVY}">${label}</div><div style="position:relative; width:${w}px; height:40px; background:#E3E9F2; border-radius:10px"><div style="position:absolute; left:${left}px; width:${width}px; height:40px; background:${color}; border-radius:10px"></div></div><div style="font-size:28px; color:${MUTED}; width:330px">${detail}</div></div>`;
}

export function buildInvestorSlides(): string[] {
  page = 0;
  const s: string[] = [];

  s.push(section('cover', true, `
    <div style="margin-top:150px; display:flex; flex-direction:column; gap:36px">
      <div style="font-size:30px; letter-spacing:4px; color:${AMBER}; font-weight:600">CALLDESK &middot; INVESTOR OVERVIEW</div>
      <h1 style="${HEAD}; font-size:104px; font-weight:700; line-height:1.02; color:#EEF2F8; max-width:1500px">AI phone agents for the small businesses that cannot staff the phones.</h1>
      <p style="font-size:38px; line-height:1.35; color:${MUTED_DARK}; max-width:1300px">The voice-agent market is crowded at the top and empty at the bottom. This is how we plan to win the bottom.</p>
    </div>`));

  s.push(section('problem', false, `${h2('A missed call is a missed customer, and small teams cannot cover the phones', false)}
    ${row([
      card('After hours', 'Nobody answers once the office closes, so callers reach voicemail.', false),
      card('Busy periods', 'Staff are on other work and calls roll over to voicemail.', false),
      card('Small teams', 'A hire whose only job is the phones is hard to justify, so the phones go uncovered.', false),
    ])}
    ${p('The alternative today is a human answering service, priced per call or per minute, or nothing at all.', false)}`));

  s.push(section('product', true, `${h2('What Calldesk does', true)}
    ${row([
      card('Answers and places calls', 'Inbound and outbound phone agents on real phone numbers. The owner forwards overflow or after-hours calls; every call gets a summary and a transcript.', true),
      card('Knows the business', 'A knowledge base per agent, call flows the owner can edit, and call analytics, in 55 languages on live calls.', true),
      card('Two voice engines, chosen per agent', 'A cascaded pipeline (speech recognition, language model, voice) for reliable transcripts and tool use, or a speech-to-speech engine for the most natural conversation. Per-call cost is tracked on every call.', true, 1.3),
    ])}
    ${note('Live today: inbound and outbound calls, knowledge base, analytics. Real Twilio phone numbers.', true)}`));

  s.push(section('landscape', false, `${h2('Who sells voice agents today', false)}
    ${row([
      card('Developer platforms', 'Retell, Vapi, Bland. Built for engineers who assemble an agent, priced per minute with a platform fee and add-ons.', false, 1, true),
      card('Enterprise suites', 'Synthflow publishes one tier: enterprise, from $30,000 a year. Sold to larger organizations with onboarding and SLAs.', false, 1, true),
      card('Speech vendors moving up', 'ElevenLabs and Deepgram now sell agent products on top of their voice and recognition models. They are also suppliers to everyone else.', false, 1, true),
      card('Human and hybrid receptionists', 'Smith.ai and Ruby answer small-business phones today, priced per call or per minute.', false, 1, true),
    ])}
    ${p('Almost none of these sell to a plumber, a tow operator or a dental office directly. They sell to the person who builds the agent.', false)}`));

  s.push(section('price', false, `${h2('Price per minute: where we sit', false)}
    <div style="display:flex; flex-direction:column; gap:16px; margin-top:0">
      ${bar('Calldesk', STANDARD_CENTS / 100, PRO_CENTS / 100, `${STANDARD_CENTS} cents Standard (phone line extra), ${PRO_CENTS} cents Pro (numbers included); Lite ${LITE_CENTS} cents (lowest-cost voice)`, AMBER)}
      ${bar('Retell', 0.07, 0.31, '$0.07 to $0.31 (add-ons extra); its own example: $0.11', '#6C84AD')}
      ${bar('Vapi', 0.082, 0.129, 'about $0.08 to $0.13 all in', '#6C84AD')}
      ${bar('Bland', 0.12, 0.14, '$0.12 to $0.14 (plan fee $299 a month)', '#6C84AD')}
      ${bar('ElevenLabs Agents', 0.08, 0.16, 'from $0.08, $0.16 at burst', '#6C84AD')}
      ${bar('Deepgram Voice Agent', 0.075, 0.163, '$0.075 standard, $0.163 advanced', '#6C84AD')}
    </div>
    ${note(`List prices from each vendor's own pricing page, retrieved ${PRICING_AS_OF}; bars show the published range. Retell's own worked example on retellai.com/pricing is about $0.11 a minute. Vapi range is its own 1,000-minute example ($82 to $129). Synthflow publishes no per-minute price (enterprise from $30,000 a year). Enterprise discounts are not shown. We are at parity with the platforms; our edge is who we sell to.`, false)}`));

  s.push(section('human', true, `${h2('Against a human answering service, the gap is 30x or more', true)}
    ${row([
      card('Calldesk', `${LIVE_RANGE_WORDS} a minute (Standard to Pro).<br/>About <b>${twoMinuteCallRange()}</b> for a 2-minute call.`, true),
      card('Smith.ai', '$300 a month for 30 calls ($10 a call) down to $2,100 for 300 calls ($7 a call). Over plan: $8.50 to $11.50 a call.', true),
      card('Ruby', '$250 a month for 50 minutes ($5.00 a minute) down to $1,725 for 500 minutes ($3.45 a minute).', true),
    ])}
    ${note(`Assumes a 2-minute call (one of our own test calls ran about 2 minutes). Prices from each company's pricing page, retrieved ${PRICING_AS_OF}. A human can handle calls an agent cannot, so this is a price anchor and not a claim of equivalence.`, true)}`));

  s.push(section('compete', true, `${h2('How we intend to compete', true)}
    ${row([
      card('1. Sell an outcome, not a platform', 'A pre-built agent per trade (towing, septic, home services, dental, freight, insurance, home care, bail bonds) that works after a call-forwarding setup. The platforms sell tools to engineers.', true, 1, true),
      card('2. Price a small business can say yes to', 'Per minute, no monthly minimum, and a free two-week pilot capped at 50 minutes. Against a human service the saving is obvious on the first invoice.', true, 1, true),
    ])}
    ${row([
      card('3. A cost-to-serve edge', 'Model-agnostic stack, per-call cost tracking, and a self-hosted voice for the default tier, with paid voices at a premium. Platforms that resell their suppliers cannot go below their suppliers.', true, 1, true),
      card('4. We find the customers ourselves', 'A registry-driven pipeline turns public licensing records into reachable businesses, so we start conversations instead of waiting for developers to sign up.', true, 1, true),
    ])}`));

  s.push(section('behind', false, `${h2('Where we are behind, and what closes it', false)}
    ${row([
      card('Brand and proof', 'Established platforms have customers and case studies. We have none published yet. Closing it: pilots in a few trades, then named results.', false, 1, true),
      card('Compliance and enterprise features', 'Leaders offer HIPAA agreements, SSO and dedicated support at the enterprise tier. We will add what each trade needs (dental and home care first), not the whole checklist.', false, 1, true),
      card('Latency and voice quality', 'Our measured time to first audio on the premium-voice path is 1.2 to 1.8 seconds. Faster turn handling and the speech-to-speech engine are the focus.', false, 1, true),
    ])}
    ${p('Suppliers can also become rivals. The stack is model-agnostic so that no single vendor sets our price or our roadmap.', false)}`));

  s.push(section('roadmap', true, `${h2('The roadmap to owning the stack', true)}
    ${row([
      card('Now: vendors, measured', 'The live stack runs on best-in-class vendors. Per-call cost and latency are tracked, and an open voice model is already self-hosted for the default tier. Next we build an evaluation set from real phone audio.', true, 1, true),
      card('Next: adapt, do not rebuild', 'Trade vocabulary and phone-line adaptation for speech recognition. A small tuned model for routine call steps, with a router that sends hard turns to a frontier model. Licensed custom voices.', true, 1, true),
    ])}
    ${row([
      card('Then: replace where we win', 'Swap a vendor layer for our own only when it matches the vendor on our held-out calls at lower cost and latency. Likely order: voice, then recognition, then the language model.', true, 1, true),
      card('Later: a model built for phone calls', 'A purpose-built speech-to-speech model for our trades, trained on consented call data, with vendors kept as the fallback.', true, 1, true),
    ])}
    ${note('Each step is gated on measured results on our own held-out calls, not on a date.', true)}`));

  s.push(section('data', false, `${h2('How the data flywheel starts', false)}
    ${row([
      card('Pilots earn the data', 'Every pilot runs on opt-in terms, so the calls it produces can be used to improve the product.', false, 1, true),
      card('Consented and de-identified', 'Callers are told the call is recorded. Names, numbers and addresses are redacted before any training use.', false, 1, true),
    ])}
    ${row([
      card('From data to models', 'Consented calls become evaluation sets first, then training sets for speech recognition, a tuned language model and custom voices.', false, 1, true),
      card('The flywheel', 'Better models cut cost per minute and raise accuracy on each trade\'s vocabulary, which wins more pilots, which brings more consented data.', false, 1, true),
    ])}`));

  s.push(section('distribution', true, `${h2('A repeatable way to reach small businesses', true)}
    ${row([
      card('Public licensing records', `We have built loaders for state and national registries and keep a database of 558,000+ businesses sourced from them: 41 US states with 100+ records each, 16 trades, and 7 other countries.`, true, 1.2),
      card('Phone first, email second', 'Many registries publish phone numbers and few publish email, so calling is the main channel, with email and website discovery filling in the rest. Personal and home lines are kept off call lists.', true, 1.2),
      card('A simple offer', `Free two-week pilot on a forwarded number, then ${STANDARD_CENTS} cents a minute (Standard, phone line billed separately) or ${PRO_CENTS} cents (Pro, phone numbers included), with no minimum.`, true),
    ])}
    ${note('Counts are from our own lead database as of October 1, 2026. These are businesses we can reach, not customers.', true)}`));

  s.push(section('team', false, `${h2('Team', false)}
    ${row([
      card('Sushanth Tiruvaipati, co-founder', 'Fifteen years of engineering at Amazon, Microsoft, VMware and Google, on billing and metering systems, conversation AI, large-scale ranking and fraud detection. M.S., Carnegie Mellon. Built the Calldesk platform: the voice engine, call flows, dashboard and the outreach pipeline. Also ships a portfolio of consumer apps independently.', false, 1.3, true),
      card('Deepikarani Parameswarappa, co-founder', 'Site reliability engineer at Twitter. Earlier built network telemetry and observability software at Ciena, including a containerized gRPC telemetry collector and monitoring dashboards. Studied at Illinois Institute of Technology.', false, 1, true),
    ])}
    ${row([
      card('Conversation AI at scale', 'Google Cloud Contact Center AI: topic modeling for customer conversations.', false, 1, true),
      card('Billing and metering', 'AWS billing and marketplace systems at Amazon; payments latency at Google Pay.', false, 1, true),
      card('Abuse and fraud', 'Enforcement against fraudulent advertisers at Google, like abuse of outbound calling.', false, 1, true),
    ])}`));

  s.push(section('ask', false, `
    <div style="margin-top:100px; display:flex; flex-direction:column; gap:40px">
      <div style="font-size:30px; letter-spacing:4px; font-weight:600">THE ASK</div>
      <h2 style="${HEAD}; font-size:80px; font-weight:700; line-height:1.07; max-width:1560px">We are raising $500K on a SAFE.</h2>
      <div style="display:flex; flex-direction:column; gap:20px; font-size:38px; line-height:1.35; max-width:1500px">
        <div>1. Run pilots in three trades.</div>
        <div>2. Add the compliance work dental and home care need.</div>
        <div>3. Self-host our voice at scale for the default tier.</div>
      </div>
      <p style="font-size:36px; line-height:1.4; max-width:1400px; font-weight:600">This round reaches pilots converting to paid in three trades.</p>
    </div>`, AMBER));

  s.push(section('contact', true, `
    <div style="margin-top:170px; display:flex; flex-direction:column; gap:30px">
      <h2 style="${HEAD}; font-size:92px; font-weight:700; line-height:1.05">Talk to us.</h2>
      <p style="font-size:38px; line-height:1.4; color:${MUTED_DARK}">t.sushanth@gmail.com &middot; calldesk.tech</p>
      <p style="font-size:30px; line-height:1.4; color:${MUTED_DARK}">Try the live demo on the site, or ask us to run a pilot on your phone line.</p>
    </div>`));

  return s;
}

export const INVESTOR_SLIDES: string[] = buildInvestorSlides();

/** TODO(...) markers still present; the page must not serve to the public until this is empty. */
export function investorDeckTodos(slides: string[] = INVESTOR_SLIDES): string[] {
  return slides.flatMap((h) => [...h.matchAll(/TODO\(([^)]*)\)/g)].map((m) => m[1]));
}
