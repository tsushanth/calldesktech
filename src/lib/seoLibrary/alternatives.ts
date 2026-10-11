import {
  BILLING, CALLDESK_NAME, DEVELOPER, LANGUAGES, PHONE_NUMBERS, TIERS, TIER_RANGE_LABEL, VERIFIED_STATEMENTS,
} from '@/content/calldeskFacts';
import type { Competitor } from './schema';
import type { Library } from './load';
import type { Block } from './model';
import { NOT_STATED, itemLabel, lowerLead, joinList, joinOr, longDate, lowerFirst, poss, sentence } from './helpers';
import { usesSip } from './migrate';

// The body of every /alternatives/<slug>-alternatives page. Three rules keep these pages from becoming thin, near-duplicate
// programmatic pages:
//   1. Every competitor statement is read from that competitor's JSON and carries its sourceUrl where the data has one.
//   2. Every Calldesk statement is read from src/content/calldeskFacts.ts. No number, price or plan name is typed in this file
//      (test/lib/seoLibrary/templates.test.ts scans it, as it scans pages.ts).
//   3. The sections, their order and their explanatory text depend on the competitor's category and on which data points exist, and
//      the checklist is drawn from a larger pool by that competitor's own data, so two pages share facts only when the data does.

export type Category = 'platform' | 'no-code-builder' | 'answering-service' | 'cpaas' | 'enterprise' | 'model-vendor';

const CATEGORY_LABEL: Record<Category, string> = {
  platform: 'voice AI platform',
  'no-code-builder': 'no-code agent builder',
  'answering-service': 'answering service',
  cpaas: 'communications platform service',
  enterprise: 'enterprise voice AI provider',
  'model-vendor': 'speech and model vendor',
};

export function categoryOf(c: Competitor): Category {
  return (c.category in CATEGORY_LABEL ? c.category : 'platform') as Category;
}

const withArticle = (label: string): string => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
const hash = (s: string): number => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const pick = <T,>(items: T[], key: string, n: number): T[] => {
  const scored = items.map((it, i) => ({ it, k: hash(`${key}:${i}`) })).sort((a, b) => a.k - b.k).slice(0, n).map((x) => x.it);
  return items.filter((it) => scored.includes(it));
};
const hasText = (s: string | undefined | null): s is string => !!s && !/^not stated\b/i.test(s.trim());

/** The first clause of a pricing model, kept short enough to quote inside a sentence. */
function shortModel(c: Competitor): string {
  const first = c.pricing.model.split(/[;]|\.\s/)[0].trim().replace(/\.$/, '');
  if (first.length <= 150) return first;
  const cut = first.slice(0, 150);
  const comma = cut.lastIndexOf(',');
  return comma > 60 ? cut.slice(0, comma) : cut.replace(/\s+\S*$/, '');
}

/** The competitor's pricing model as one stated sentence, introduced so it reads as theirs. */
const modelLine = (c: Competitor): string => `Its pricing model, in ${poss(c.name)} words: ${sentence(shortModel(c))}`;

const priceSrc = (c: Competitor) => c.pricing.sourceUrls[0];
const realExtras = (c: Competitor) => c.pricing.whatIsExtra.filter(hasText);
const statedCerts = (c: Competitor) => ([['HIPAA', c.compliance.hipaa], ['SOC 2', c.compliance.soc2], ['GDPR', c.compliance.gdpr]] as const).filter(([, v]) => v === 'stated').map(([k]) => k);
const pricesBySales = (c: Competitor) => /contact sales|\bcustom (?:pricing|plans?|contracts?|quotes?|volume)|quote-based|not published|sales-led|no public/i.test(`${c.pricing.model} ${c.pricing.headline}`);
const hasPublicRate = (c: Competitor) => c.pricing.perMinuteUsd !== null;
const trialText = (c: Competitor) => (hasText(c.pricing.freeTrial) ? c.pricing.freeTrial : '');
const numbersText = (c: Competitor): string => {
  const v = c.telephony.providedNumbers;
  if (typeof v === 'string') return hasText(v) ? v : '';
  return v === true ? 'The vendor provides numbers.' : v === false ? 'The vendor does not provide numbers.' : '';
};
const exportStatement = (c: Competitor): string => {
  const v = c.migration.exportAgentsPossible;
  if (typeof v === 'string') return /^unknown$/i.test(v.trim()) ? '' : v;
  return v === true ? 'Exporting agents is described as possible.' : v === false ? 'Exporting agents is described as not possible.' : '';
};

type Item = { text: string; sourceUrl?: string };

// ---------------------------------------------------------------- related options

const ADJACENT: Record<Category, Category[]> = {
  platform: ['no-code-builder', 'model-vendor', 'cpaas'],
  'no-code-builder': ['platform', 'answering-service'],
  'answering-service': ['no-code-builder', 'enterprise'],
  cpaas: ['platform', 'model-vendor'],
  enterprise: ['platform', 'answering-service'],
  'model-vendor': ['platform', 'cpaas'],
};

type PriceFamily = 'per-minute' | 'subscription' | 'sales-led' | 'credits';
function priceFamily(c: Competitor): PriceFamily {
  const t = `${c.pricing.model} ${c.pricing.headline}`;
  const plans = /monthly|subscription|per[- ]location|plan fee|per unique|plans/i.test(c.pricing.model);
  const hidden = /contact sales|not published|no public|sales-led|enterprise contracts/i.test(t);
  if (hidden && !hasPublicRate(c)) return 'sales-led';
  if (/credit/i.test(t)) return 'credits';
  if (plans && !/pay[- ]as[- ]you[- ]go|usage-based|per[- ]minute/i.test(c.pricing.model)) return 'subscription';
  if (pricesBySales(c) && !hasPublicRate(c)) return 'sales-led';
  return 'per-minute';
}

export type Related = { competitor: Competitor; why: string };

const relatedCache = new WeakMap<Library, Map<string, Related[]>>();

/**
 * Three related options per competitor, chosen from the dataset by category, price model, shared integrations and an adjacent
 * category, with a load-balancing penalty so that the same few vendors are not suggested on every page.
 */
export function relatedOptions(lib: Library, c: Competitor): Related[] {
  let table = relatedCache.get(lib);
  if (!table) {
    table = new Map();
    const active = lib.competitors.filter((x) => x.status === 'active').sort((a, b) => a.slug.localeCompare(b.slug));
    const picks = new Map<string, number>();
    for (const a of active) {
      const aInt = a.integrations.map((i) => i.toLowerCase());
      const ranked = active.filter((o) => o.slug !== a.slug).map((o) => {
        const shared = o.integrations.filter((i) => aInt.includes(i.toLowerCase())).length;
        const score =
          (o.category === a.category ? 4 : 0) +
          (priceFamily(o) === priceFamily(a) ? 2 : 0) +
          (ADJACENT[categoryOf(a)].includes(categoryOf(o)) ? 1.5 : 0) +
          Math.min(shared, 2) * 0.5 -
          (picks.get(o.slug) ?? 0) * 0.8 +
          (hash(`${a.slug}>${o.slug}`) % 100) / 1000;
        return { o, score };
      }).sort((x, y) => y.score - x.score).slice(0, 3);
      const mine: Related[] = ranked.map(({ o }) => { picks.set(o.slug, (picks.get(o.slug) ?? 0) + 1); return { competitor: o, why: relationSentence(a, o) }; });
      table.set(a.slug, mine);
    }
    relatedCache.set(lib, table);
  }
  return table.get(c.slug) ?? [];
}

const FAMILY_PHRASE: Record<PriceFamily, string> = {
  'per-minute': 'bills by usage',
  subscription: 'sells monthly plans',
  'sales-led': 'prices through a sales conversation',
  credits: 'prices in credits',
};

const FAMILY_PLURAL: Record<PriceFamily, string> = {
  'per-minute': 'bill by usage',
  subscription: 'sell monthly plans',
  'sales-led': 'price through a sales conversation',
  credits: 'price in credits',
};

function relationSentence(a: Competitor, o: Competitor): string {
  const fa = priceFamily(a);
  const fo = priceFamily(o);
  const parts: string[] = [];
  const same = a.category === o.category;
  parts.push(same
    ? `${o.name} is also ${withArticle(CATEGORY_LABEL[categoryOf(o)])}, and it ${FAMILY_PHRASE[fo]}${fa === fo ? ` as ${a.name} does` : `, where ${a.name} ${FAMILY_PHRASE[fa]}`}.`
    : `${o.name} is ${withArticle(CATEGORY_LABEL[categoryOf(o)])} rather than ${withArticle(CATEGORY_LABEL[categoryOf(a)])} like ${a.name}, and it ${FAMILY_PHRASE[fo]}${fa === fo ? ` as ${a.name} does` : `, where ${a.name} ${FAMILY_PHRASE[fa]}`}.`);
  const aInt = a.integrations.map((i) => i.toLowerCase());
  const shared = o.integrations.filter((i) => aInt.includes(i.toLowerCase()));
  if (shared.length) parts.push(`Both list ${joinList(shared.slice(0, 2))} among their integrations.`);
  const sa = statedCerts(a);
  const so = statedCerts(o);
  if (so.length && so.join() === sa.join()) parts.push(`The pages of both mention ${joinList(so)}.`);
  else if (so.length || sa.length) {
    const said = (x: Competitor, list: string[]) => (list.length ? `${poss(x.name)} pages mention ${joinList(list)}` : `${poss(x.name)} pages did not mention HIPAA, SOC 2 or GDPR where we looked`);
    parts.push(`${said(o, so)}, while ${said(a, sa)}.`);
  }
  if (o.telephony.bringYourOwnCarrier === 'yes' && a.telephony.bringYourOwnCarrier !== 'yes') parts.push(`${poss(o.name)} pages say bringing your own carrier is supported, which ${poss(a.name)} pages do not settle.`);
  if (hasText(trialText(o)) && !hasText(trialText(a))) parts.push(`${o.name} also lists a free way to start, so you can try it with your own script.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- sections

function whoSuits(c: Competitor, cat: Category): Block[] {
  const fit = c.bestFor ? lowerFirst(sentence(c.bestFor)) : '';
  const family = FAMILY_PHRASE[priceFamily(c)];
  const out: Block[] = [{ kind: 'h2', text: cat === 'answering-service' ? `What kind of service ${c.name} is` : `Who ${c.name} suits` }];
  const audience = fit ? `The audience its pages name is ${fit}` : `${poss(c.name)} pages do not say who it is built for, so judge the fit from the sections below.`;
  switch (cat) {
    case 'answering-service':
      out.push({ kind: 'p', text: `We file ${c.name} under answering services, which usually means a managed arrangement rather than software you configure yourself, and it ${family}. ${audience}` });
      break;
    case 'enterprise':
      out.push({ kind: 'p', text: `We file ${c.name} under enterprise providers, vendors aimed at larger organisations that often sell through contracts and managed rollouts as well as, or instead of, self-serve plans, and it ${family}. ${audience}` });
      break;
    case 'no-code-builder':
      out.push({ kind: 'p', text: `We file ${c.name} under no-code builders, where an agent is assembled without writing code, and it ${family}. ${audience}` });
      break;
    case 'cpaas':
      out.push({ kind: 'p', text: `We file ${c.name} under communications platform services, where voice AI sits beside other telephony products, and it ${family}. ${audience}` });
      break;
    case 'model-vendor':
      out.push({ kind: 'p', text: `We file ${c.name} under speech and model vendors, companies that started from speech or language models and offer agents on top of them, and it ${family}. ${audience}` });
      break;
    default:
      out.push({ kind: 'p', text: `We file ${c.name} under voice AI platforms, where you build and run agents yourself, and it ${family}. ${audience}` });
  }
  return out;
}

function pricingBlocks(c: Competitor, cat: Category): Block[] {
  const out: Block[] = [{ kind: 'h2', text: `How ${c.name} prices` }];
  const model = sentence(c.pricing.model);
  const extras = realExtras(c);
  const src = priceSrc(c);
  const headline = c.pricing.headline ? sentence(c.pricing.headline) : '';
  switch (cat) {
    case 'answering-service':
      out.push({ kind: 'p', text: `Answering services usually charge by a unit that is not a minute of AI talk time, such as a location, a call or a block of receptionist minutes, so two quotes can look far apart while covering different things. ${c.name} describes its model as: ${model}` });
      break;
    case 'enterprise':
      out.push({ kind: 'p', text: `${c.name} sells through a sales conversation rather than a price list, so the figures you can compare in advance are limited. It describes its pricing model as: ${model}` });
      break;
    case 'no-code-builder':
      out.push({ kind: 'p', text: `Builders often bill by something other than minutes, such as a subscription tier, a customer count or a per-seat fee, so a per-minute figure may not exist or may be a derived illustration. ${c.name} describes its model as: ${model}` });
      break;
    case 'cpaas':
      out.push({ kind: 'p', text: `A communications platform price usually covers one layer of the call, with carrier, number and model charges arriving on other lines of the bill. ${c.name} describes its model as: ${model}` });
      break;
    case 'model-vendor':
      out.push({ kind: 'p', text: `A speech or model vendor prices what it supplies, so the question is what the quoted rate leaves for you to buy elsewhere. ${c.name} describes its model as: ${model}` });
      break;
    default:
      out.push({ kind: 'p', text: `On a platform that bills by usage, check what the headline rate covers. ${c.name} describes its model as: ${model}` });
  }
  if (headline) out.push({ kind: 'p', text: `What the published figure says: ${headline}${hasPublicRate(c) ? `${/\bplus\b|separately|on top|beyond/i.test(c.pricing.headline) ? ' Read the per-minute figure as the number the page shows, not as a total for a finished call.' : ''}` : ' It does not give a single per-minute rate we could compare directly.'}` });
  if (c.pricing.planNotes.length) {
    out.push({ kind: 'list', items: c.pricing.planNotes.map((text) => ({ text, sourceUrl: src })) });
  }
  if (extras.length) {
    out.push({ kind: 'p', text: `Billed separately or extra on ${c.name}, which matters when you total a month:` });
    out.push({ kind: 'list', items: extras.map((text) => ({ text, sourceUrl: src })) });
  }
  const trial = trialText(c);
  if (trial) out.push({ kind: 'p', text: `Trying it first: ${sentence(trial)}` });
  return out;
}

function strengthsBlocks(c: Competitor): Block[] {
  const out: Block[] = [{ kind: 'h2', text: `What ${c.name} does well` }];
  out.push({ kind: 'p', text: `Strengths ${poss(c.name)} own pages describe, each linked to its source:` });
  out.push({ kind: 'list', items: c.strengths.map((s) => ({ text: s.claim, sourceUrl: s.sourceUrl })) });
  return out;
}

function limitsBlocks(c: Competitor, cat: Category): Block[] {
  const out: Block[] = [{ kind: 'h2', text: cat === 'enterprise' ? `Conditions to check with ${c.name}` : `Limits to know about ${c.name}` }];
  if (c.limitations.length) {
    out.push({ kind: 'p', text: `Described on ${poss(c.name)} own pages; whether ${c.limitations.length === 1 ? 'it matters' : 'they matter'} depends on your calls.` });
    out.push({ kind: 'list', items: c.limitations.map((s) => ({ text: s.claim, sourceUrl: s.sourceUrl })) });
  } else {
    out.push({ kind: 'p', text: `We did not find stated limits on ${poss(c.name)} pages. That is not evidence that none exist; it means the reasons to look elsewhere are more likely to be price, phone setup, languages or the tools you need to connect.` });
  }
  return out;
}

function integrationBlocks(c: Competitor, cat: Category): Block[] {
  const out: Block[] = [{ kind: 'h2', text: cat === 'enterprise' ? `Deployment, integrations and telephony at ${c.name}` : `Integrations and telephony at ${c.name}` }];
  if (c.integrations.length) {
    const shown = c.integrations.slice(0, 12);
    const rest = c.integrations.length - shown.length;
    out.push({ kind: 'p', text: `${poss(c.name)} pages name these connections: ${joinList(shown)}${rest > 0 ? `, and ${rest} more` : ''}. Test the one you depend on.` });
  } else {
    out.push({ kind: 'p', text: `${poss(c.name)} pages did not give us a list of integrations.` });
  }
  const items: Item[] = [];
  const byoc = c.telephony.bringYourOwnCarrier;
  items.push({
    text: byoc === 'yes'
      ? `Bring your own carrier: ${poss(c.name)} pages say this is supported.`
      : byoc === 'no'
        ? `Bring your own carrier: ${poss(c.name)} pages describe it as not supported.`
        : '',
    sourceUrl: c.telephony.sourceUrl,
  });
  const nums = numbersText(c);
  if (nums) items.push({ text: `Numbers from the provider: ${sentence(nums)}`, sourceUrl: c.telephony.sourceUrl });
  const real = items.filter((i) => i.text);
  if (real.length) out.push({ kind: 'list', items: real });
  return out;
}

function complianceBlocks(c: Competitor): Block[] {
  const out: Block[] = [{ kind: 'h2', text: `Compliance as stated by ${c.name}` }];
  const stated = statedCerts(c);
  const missing = (['HIPAA', 'SOC 2', 'GDPR'] as const).filter((k) => !stated.includes(k));
  out.push({
    kind: 'p',
    text: stated.length
      ? `${poss(c.name)} pages mention ${joinList(stated)}${missing.length ? `, and did not mention ${joinOr([...missing])} where we looked` : ''}. These are the vendor's own statements and we have not audited them.`
      : `${poss(c.name)} pages did not mention HIPAA, SOC 2 or GDPR where we looked. That is not evidence either way. If your industry needs one, ask ${c.name} what it can show you.`,
  });
  const page = c.sources.find((x) => c.compliance.sourceUrl && x.url.replace(/\/+$/, '') === c.compliance.sourceUrl.replace(/\/+$/, ''));
  if (c.compliance.note) out.push({ kind: 'list', items: [{ text: `Wording on file for ${c.name}${page ? `, from the page titled "${page.title}"` : ''}: ${sentence(c.compliance.note)}`, sourceUrl: c.compliance.sourceUrl }] });
  if (!stated.length) out.push({ kind: 'p', text: `${CALLDESK_NAME} claims no certification either, so ask ${c.name} and ${CALLDESK_NAME} for evidence.` });
  return out;
}

// ---------------------------------------------------------------- the checklist

type Q = { id: string; when: (c: Competitor) => boolean; text: (c: Competitor) => Item; weight: number };

const CATEGORY_QUESTIONS: Record<Category, ((c: Competitor) => string)[]> = {
  'answering-service': [
    (c) => `Who answers: ask each option, including ${c.name}, which calls are handled by software, which by people, and what happens when a call is neither.`,
    (c) => `Billing unit: ${modelLine(c)} Ask each alternative what its unit is (call, minute, location or seat) and what a quiet month and a busy month would cost.`,
    (c) => `Script changes: ask how you change what the agent says on ${c.name} and on each alternative, how long a change takes, and who makes it.`,
    (c) => `After-hours and overflow: decide whether you need the service to take all calls or only the ones you miss, and ask each option, ${c.name} included, how it handles each.`,
    (c) => `Handing a call to a person: ask each option how a caller reaches you or your staff mid-call, because ${poss(c.name)} model and an AI-first tool may handle that differently.`,
    (c) => `Call records: ask what you receive after each call on ${c.name} and on each alternative (summary, transcript, recording) and where it is delivered.`,
  ],
  enterprise: [
    (c) => `Contract shape: ${modelLine(c)} Ask each option about minimum commitment, term and pilots.`,
    (c) => `Deployment ownership: ask who builds, tunes and monitors the agents on ${c.name} and on each alternative, your team or the vendor's.`,
    (c) => `Time to a live line: ask each option, ${c.name} included, how long a first production deployment normally takes and what you must provide.`,
    (c) => `Support and service levels: ask for the support hours, response targets and any uptime commitment in writing for ${c.name} and for each alternative.`,
    (c) => `Scale: ask for the largest deployment each option, ${c.name} among them, has run in your kind of work, and whether you can speak to that customer.`,
    (c) => `Exit terms: ask what you can take with you from ${c.name} or an alternative if the contract ends, including recordings, transcripts and agent definitions.`,
  ],
  platform: [
    (c) => `Concurrency: ask each option, ${c.name} included, how many calls can run at once on the plan you would choose and what raising that costs.`,
    (c) => `Component choice: decide how much control you want over the pieces of a call, then ask what ${c.name} lets you swap and what each alternative decides for you.`,
    (c) => `Debugging a failed call: ask how you replay a call, see the transcript and find which step failed on ${c.name} and on each alternative.`,
    (c) => `Versioning and testing: ask how you change an agent safely, with a draft, a test call and a rollback, on ${c.name} and on each alternative.`,
    (c) => `Who owns the prompt and the data: confirm you can read and export your agent configuration and call data on ${c.name} and on each option you shortlist.`,
  ],
  'no-code-builder': [
    (c) => `Ceiling of the builder: build the hardest call you expect (a transfer, a lookup, a booking) in ${c.name} and in each alternative before committing.`,
    (c) => `Who edits it later: ask whether a non-engineer on your team can change the agent on ${c.name} and on each option without breaking it.`,
    (c) => `Pricing unit: ${modelLine(c)} Work out what your own volume costs under each option's unit before comparing headline numbers.`,
    (c) => `Limits on tools and seats: ask how many connected tools, agents or team members each plan allows on ${c.name} and on each alternative.`,
    (c) => `Testing before launch: ask how you rehearse calls on ${c.name} and on each alternative before a real caller reaches the agent.`,
  ],
  cpaas: [
    (c) => `Who builds the application: ${c.name} supplies a building block, so ask each alternative whether it supplies a finished agent or the same kind of block.`,
    (c) => `Whole-call price: ask each option, ${c.name} included, to price one finished call, adding the carrier, number, speech and model lines.`,
    (c) => `Network and numbers: ask which countries and number types each option covers, because ${poss(c.name)} coverage is only relevant if it matches where your callers are.`,
    (c) => `Choice of model: ask whether you can use your own language model on ${c.name} and on each alternative, and what that does to the bill.`,
    (c) => `Operations: ask who is on call when a call path fails on ${c.name} or an alternative, and what logs you can see yourself.`,
  ],
  'model-vendor': [
    (c) => `What is not included: ask ${c.name} and each alternative what you must still buy or connect (telephony, models, tools) before you have a finished phone line.`,
    (c) => `Telephony source: confirm where phone numbers and call routing come from for ${c.name} and for each option.`,
    (c) => `Switching the model: ask whether you can change the language model or voice on ${c.name} and on each alternative without rebuilding the agent.`,
    (c) => `Latency in your own setup: test a real call end to end on ${c.name} and on each alternative instead of relying on component figures.`,
    (c) => `Usage tiers: ask how ${poss(c.name)} rate changes with volume and what the equivalent is for each alternative.`,
  ],
};

function checklist(c: Competitor, cat: Category): Item[] {
  const extras = realExtras(c);
  const stated = statedCerts(c);
  const trial = trialText(c);
  const exp = exportStatement(c);
  const mig = c.migration.stepsToLeave[0];
  const unk = c.unknowns;
  const pool: Q[] = [
    { id: 'extras', weight: 9, when: () => extras.length > 0, text: () => ({ text: `Whole bill: ${poss(c.name)} pages list ${joinList(extras.slice(0, 3).map((x) => lowerLead(itemLabel(x))))} as billed separately or extra, so price a full month with every charge in it.`, sourceUrl: priceSrc(c) }) },
    { id: 'no-extras', weight: 9, when: () => extras.length === 0, text: () => ({ text: `Whole bill: ${poss(c.name)} pages did not itemise what is billed on top of its rate, so ask for a full month at your volume.` }) },
    { id: 'rate', weight: 7, when: () => hasPublicRate(c), text: () => ({ text: `What the rate covers: ask what ${poss(c.name)} per-minute figure includes and what it leaves out, and ask the same of each option's own figure, before comparing numbers.`, sourceUrl: priceSrc(c) }) },
    { id: 'no-rate', weight: 7, when: () => !hasPublicRate(c), text: () => ({ text: `Comparable rate: ${c.name} does not publish one per-minute rate, so ask for a worked example in writing.`, sourceUrl: priceSrc(c) }) },
    { id: 'trial', weight: 6, when: () => !!trial, text: () => ({ text: `Hands-on test: ${c.name} states: ${sentence(trial)} Ask each option for a test of the same depth, with your own script.`, sourceUrl: priceSrc(c) }) },
    { id: 'byoc-yes', weight: 7, when: () => c.telephony.bringYourOwnCarrier === 'yes', text: () => ({ text: `Keeping your numbers: ${c.name} supports bringing your own carrier, so check that every option on your list accepts the carrier you have.`, sourceUrl: c.telephony.sourceUrl }) },
    { id: 'byoc-no', weight: 7, when: () => c.telephony.bringYourOwnCarrier === 'no', text: () => ({ text: `Keeping your numbers: ${poss(c.name)} pages describe bringing your own carrier as unsupported, so ask how your current numbers would be connected.`, sourceUrl: c.telephony.sourceUrl }) },
    { id: 'byoc-unknown', weight: 7, when: () => c.telephony.bringYourOwnCarrier === 'unknown', text: () => ({ text: `Keeping your numbers: whether ${c.name} accepts your own carrier is ${NOT_STATED}, so settle that before you plan around your current numbers.` }) },
    { id: 'numbers', weight: 4, when: () => !!numbersText(c), text: () => ({ text: `Number setup: ${sentence(numbersText(c))} Check whether a new number, a forwarded line or your own carrier is the normal route with each option.`, sourceUrl: c.telephony.sourceUrl }) },
    { id: 'certs', weight: 6, when: () => stated.length > 0, text: () => ({ text: `Compliance paperwork: ${poss(c.name)} pages mention ${joinList(stated)}. Ask for the documents behind that wording and for what applies to your plan.`, sourceUrl: c.compliance.sourceUrl }) },
    { id: 'no-certs', weight: 6, when: () => stated.length === 0, text: () => ({ text: `Compliance paperwork: ${poss(c.name)} pages did not mention HIPAA, SOC 2 or GDPR where we looked, so ask what it can show you if your industry needs one.` }) },
    { id: 'integrations', weight: 6, when: () => c.integrations.length >= 3, text: () => ({ text: `Your tools: ${c.name} names ${joinList(c.integrations.slice(0, 3))} among its integrations. Check your own list of systems against each option, not a count.` }) },
    { id: 'few-integrations', weight: 6, when: () => c.integrations.length > 0 && c.integrations.length < 3, text: () => ({ text: `Your tools: ${poss(c.name)} pages name ${joinList(c.integrations)} and little else, so check the systems you depend on and ask about an API for the rest.` }) },
    { id: 'leaving', weight: 5, when: () => !!mig, text: () => ({ text: `Leaving ${c.name}: ${/^(read|retrieve|list|call|export|download|recreate|use|contact|open|request|look)\b/i.test(mig!) ? `the first step its pages give is to ${lowerFirst(sentence(mig!))}` : sentence(mig!)} Ask each option what moving in would involve.`, sourceUrl: c.migration.sourceUrls[0] }) },
    { id: 'export', weight: 4, when: () => !!exp, text: () => ({ text: `Taking your agents with you: ${sentence(exp)} Ask what you would need to rebuild.`, sourceUrl: c.migration.sourceUrls[0] ?? priceSrc(c) }) },
    { id: 'limit0', weight: 6, when: () => c.limitations.length > 0, text: () => ({ text: `A condition on ${poss(c.name)} pages: ${sentence(c.limitations[0].claim)} Decide whether it applies to your calls.`, sourceUrl: c.limitations[0].sourceUrl }) },
    { id: 'limit1', weight: 3, when: () => c.limitations.length > 1, text: () => ({ text: `Another condition: ${sentence(c.limitations[1].claim)} Check whether it changes your plan.`, sourceUrl: c.limitations[1].sourceUrl }) },
    { id: 'unknown0', weight: 5, when: () => unk.length > 0, text: () => ({ text: `An open point we could not settle from ${poss(c.name)} pages: ${sentence(unk[0])} Ask ${c.name} directly.` }) },
    { id: 'unknown1', weight: 3, when: () => unk.length > 1, text: () => ({ text: `A second open point: ${sentence(unk[1])} It is worth a question before you decide to stay or leave.` }) },
    { id: 'languages', weight: 3, when: () => true, text: () => ({ text: `Languages and voice: listen to each shortlisted option in the language and accent your callers use; for reference, ${CALLDESK_NAME} lists ${LANGUAGES.headline}.` }) },
  ];
  const catQs = CATEGORY_QUESTIONS[cat].map((f, i) => ({ id: `cat${i}`, weight: 8, when: () => true, text: (x: Competitor) => ({ text: f(x) }) }) as Q);
  const chosenCat = pick(catQs, `${c.slug}:cat`, 1);
  const jitter = (q: Q) => (hash(`${c.slug}:${q.id}`) % 30) / 10;
  const usable = pool.filter((q) => q.when(c)).sort((a, b) => b.weight + jitter(b) - (a.weight + jitter(a)));
  const selected = [...usable.slice(0, 9 - chosenCat.length), ...chosenCat];
  const order = (q: Q) => hash(`${c.slug}:order:${q.id}`);
  return selected.sort((a, b) => order(a) - order(b)).map((q) => q.text(c));
}

// ---------------------------------------------------------------- Calldesk fit

function fitBlocks(c: Competitor, cat: Category): Block[] {
  const out: Block[] = [{ kind: 'h2', text: `Where ${CALLDESK_NAME} fits and where it may not` }];
  out.push({ kind: 'p', text: `We make ${CALLDESK_NAME}, so this section includes the cases where ${c.name} is the better match.` });

  const fits: Item[] = [];
  const family = priceFamily(c);
  const rates = `${TIER_RANGE_LABEL} per minute depending on the plan${BILLING.noMonthlyMinimum ? ', with no monthly minimum' : ''}, plus phone carrier charges`;
  // "Easier to total" is only fair when the competitor bills the parts of a call on separate lines.
  const componentBilling = realExtras(c).filter((x) => /\b(LLM|language model|transcri\w*|speech|voice)\b/i.test(x)).length >= 2;
  const lowRate = TIERS[0].centsPerMinute / 100;
  const highRate = TIERS[TIERS.length - 1].centsPerMinute / 100;
  const overlaps = c.pricing.perMinuteUsd !== null && c.pricing.perMinuteUsd >= lowRate && c.pricing.perMinuteUsd <= highRate;
  if (family === 'per-minute' && componentBilling) fits.push({ text: `${modelLine(c)} ${CALLDESK_NAME} bills one per-minute rate per plan (${rates}), which may be easier to total without separate lines for the parts of a call.` });
  else if (family === 'per-minute') fits.push({ text: `${modelLine(c)} ${CALLDESK_NAME} also bills per minute (${rates}). ${overlaps ? 'The headline per-minute figures overlap, so compare' : 'Compare'} what each one includes on a month of your own calls.` });
  else if (family === 'sales-led') fits.push({ text: `${modelLine(c)} ${CALLDESK_NAME} publishes its per-minute rates, so a small team can see a price without a sales call.` });
  else fits.push({ text: `${modelLine(c)} ${CALLDESK_NAME} charges per minute instead (${rates}), which may suit you if your call volume swings from month to month.` });
  if (c.telephony.bringYourOwnCarrier !== 'yes') {
    fits.push({ text: `${c.telephony.bringYourOwnCarrier === 'no' ? `${poss(c.name)} pages describe bringing your own carrier as unsupported; ` : ''}${CALLDESK_NAME} lets you register a number you own and forward calls to it at no extra charge${PHONE_NUMBERS.options.length ? `, and also sells numbers through ${joinList(PHONE_NUMBERS.options.map((o) => o.carrier))}` : ''}.` });
  }
  if (cat === 'platform' || cat === 'cpaas' || cat === 'model-vendor') {
    fits.push({ text: `${CALLDESK_NAME} has a REST API${DEVELOPER.mcpServer ? ', an MCP server' : ''} and ${DEVELOPER.webhooksSigned ? 'signed ' : ''}webhooks (${DEVELOPER.docsPath}) if you want to drive agents from code${componentBilling ? ', but it is a packaged agent, not a set of parts to assemble' : ''}.` });
  } else if (cat === 'no-code-builder') {
    fits.push({ text: `${CALLDESK_NAME} has a flow builder and agent templates, and agents can also be managed by API. Build the hardest call you expect in both ${c.name} and ${CALLDESK_NAME} before choosing.` });
  } else if (cat === 'answering-service') {
    fits.push({ text: `${CALLDESK_NAME} is software you configure to answer calls, with a summary and transcript after each. ${c.name} offers a different arrangement, so decide which you want before comparing prices.` });
  } else {
    fits.push({ text: `${CALLDESK_NAME} is self-serve, so an organisation that wants the managed rollout ${c.name} describes may prefer ${c.name}.` });
  }
  out.push({ kind: 'p', text: `Where ${CALLDESK_NAME} may fit better:` });
  out.push({ kind: 'list', items: fits });

  const better: Item[] = [];
  const stated = statedCerts(c);
  const start = hash(c.slug) % Math.max(1, c.strengths.length);
  const s1 = c.strengths[start];
  const s2 = c.strengths.length > 2 ? c.strengths[(start + 2) % c.strengths.length] : undefined;
  if (s1) better.push({ text: `${sentence(s1.claim)} Check whether ${CALLDESK_NAME} offers the same before you leave ${c.name}.`, sourceUrl: s1.sourceUrl });
  if (s2) better.push({ text: `${sentence(s2.claim)} Compare this with the ${CALLDESK_NAME} pricing page and docs before you decide.`, sourceUrl: s2.sourceUrl });
  if (stated.length) better.push({ text: `${poss(c.name)} pages mention ${joinList(stated)}, while ${CALLDESK_NAME} claims no certification. If that wording matters to your buyers, ${c.name} may be the safer starting point.`, sourceUrl: c.compliance.sourceUrl });
  if (usesSip(c)) better.push({ text: `${poss(c.name)} pages describe SIP trunking, and ${CALLDESK_NAME} does not offer it. If you connect your phone system by SIP trunk, ${c.name} may be the better match.`, sourceUrl: c.telephony.sourceUrl });
  if (!stated.length && c.integrations.length) better.push({ text: `If you need ${joinList(c.integrations.slice(0, 2))}, which ${c.name} names, confirm that ${CALLDESK_NAME} connects to it through calendar booking, the API or webhooks before assuming it does.` });
  out.push({ kind: 'p', text: `Where ${c.name} may fit better:` });
  out.push({ kind: 'list', items: better });
  return out;
}

// ---------------------------------------------------------------- other options

function optionCards(lib: Library, c: Competitor, planPriceList: string): Block[] {
  const rel = relatedOptions(lib, c);
  const cards = [
    { name: CALLDESK_NAME, card: { title: CALLDESK_NAME, text: `Per-minute plans (${planPriceList}), with phone carrier charges billed separately. You can register a number you own and forward calls to it; ${VERIFIED_STATEMENTS.sipTrunking ? 'SIP trunking is offered' : 'SIP trunking is not offered'}. Our own product.`, href: '/pricing', meta: 'Made by the publisher of this page', sourceUrl: undefined as string | undefined } },
    ...rel.map((r) => ({
      name: r.competitor.name,
      card: { title: r.competitor.name, text: r.why, href: r.competitor.url, external: true, meta: `Verified ${r.competitor.retrievedAt}`, sourceUrl: r.competitor.pricing.sourceUrls[0] },
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return [
    { kind: 'h2', text: `Other options to consider besides ${c.name}` },
    { kind: 'cards', items: cards.map((x) => x.card) },
  ];
}

// ---------------------------------------------------------------- what we read

const normUrl = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

function evidenceBlocks(c: Competitor): Block[] {
  const title = (u: string | undefined) => c.sources.find((x) => u && normUrl(x.url) === normUrl(u))?.title;
  const used = new Map<string, string[]>();
  const add = (t: string | undefined, what: string) => { if (!t) return; const list = used.get(t) ?? []; if (!list.includes(what)) list.push(what); used.set(t, list); };
  c.pricing.sourceUrls.forEach((u) => add(title(u), 'pricing'));
  add(title(c.compliance.sourceUrl), 'compliance wording');
  add(title(c.telephony.sourceUrl), 'phone setup');
  c.strengths.forEach((x) => add(title(x.sourceUrl), 'strengths'));
  c.limitations.forEach((x) => add(title(x.sourceUrl), 'limits'));
  const parts = [...used.entries()].map(([t, what]) => `"${t}" (${joinList(what)})`);
  return [
    { kind: 'h2', text: `What we read about ${c.name}` },
    { kind: 'p', text: `This page rests on ${c.sources.length} ${c.sources.length === 1 ? 'page' : 'pages'} from ${poss(c.name)} public site, last read on ${longDate(c.retrievedAt)}${parts.length ? `. The facts above came from ${joinList(parts)}` : ''}. Anything those pages did not say is shown as not stated, not guessed.` },
  ];
}

// ---------------------------------------------------------------- the page body

export function alternativesBody(lib: Library, c: Competitor, ctx: { planPriceList: string }): { blocks: Block[]; relatedSlugs: string[] } {
  const cat = categoryOf(c);
  const rel = relatedOptions(lib, c);
  const blocks: Block[] = [];
  blocks.push(...whoSuits(c, cat));
  // order depends on what a buyer of this kind of product weighs first
  const pricing = pricingBlocks(c, cat);
  const strengths = strengthsBlocks(c);
  const limits = limitsBlocks(c, cat);
  const integ = integrationBlocks(c, cat);
  const comp = complianceBlocks(c);
  const sections: Record<Category, Block[][]> = {
    platform: [strengths, pricing, limits, integ, comp],
    'model-vendor': [strengths, integ, pricing, limits, comp],
    cpaas: [pricing, strengths, integ, limits, comp],
    'no-code-builder': [strengths, limits, pricing, integ, comp],
    'answering-service': [strengths, pricing, integ, limits, comp],
    enterprise: [strengths, comp, pricing, integ, limits],
  };
  for (const s of sections[cat]) blocks.push(...s);
  blocks.push({ kind: 'h2', text: `What to check before choosing an alternative to ${c.name}` });
  blocks.push({ kind: 'p', text: `${poss(c.name)} pages describe ${c.limitations.length} condition${c.limitations.length === 1 ? '' : 's'} and leave ${c.unknowns.length} point${c.unknowns.length === 1 ? '' : 's'} open; these questions start there. Put each one to every option you shortlist.` });
  blocks.push({ kind: 'list', ordered: true, items: checklist(c, cat) });
  blocks.push(...fitBlocks(c, cat));
  blocks.push(...optionCards(lib, c, ctx.planPriceList));
  if (c.unknowns.length) {
    blocks.push({ kind: 'h2', text: `What we could not confirm about ${c.name}` });
    blocks.push({ kind: 'list', items: c.unknowns.map((text) => ({ text })) });
  }
  blocks.push(...evidenceBlocks(c));
  return { blocks, relatedSlugs: rel.map((r) => r.competitor.slug) };
}

export function alternativesLede(c: Competitor, date: string): string {
  const cat = categoryOf(c);
  return `${c.name} is ${withArticle(CATEGORY_LABEL[cat])}. Its pages describe it this way: ${sentence(c.positioning)} Reviewed ${date}.`;
}

export function alternativesDescription(c: Competitor, date: string, n: number): string {
  return `Choosing a ${c.name} alternative: strengths, pricing, a checklist from its pages and ${n} related option${n === 1 ? '' : 's'} plus ${CALLDESK_NAME}. Reviewed ${date}.`;
}
