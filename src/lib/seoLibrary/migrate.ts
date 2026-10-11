import { BILLING, CALLDESK_NAME, LANGUAGES, PHONE_NUMBERS, VERIFIED_STATEMENTS } from '@/content/calldeskFacts';
import type { Competitor } from './schema';
import type { Block } from './model';
import { joinOr, lowerFirst, poss, sentence } from './helpers';

// Migration-specific sections. Everything about the competitor comes from its JSON (positioning, category, telephony, pricing,
// migration, unknowns); everything about Calldesk comes from calldeskFacts.ts. No number or price is typed here.

const text = (s: string): { text: string } => ({ text: s });

/** True when the competitor's own data mentions SIP for its phone numbers. */
export function usesSip(c: Competitor): boolean {
  const hay = [typeof c.telephony.providedNumbers === 'string' ? c.telephony.providedNumbers : '', ...c.integrations, ...c.migration.stepsToLeave].join(' ');
  return /\bSIP\b/i.test(hay);
}

/** One paragraph on how the move differs by kind of product. Plain statements about how that kind of product usually works, not claims about a named vendor. */
export function categoryParagraph(c: Competitor): string {
  switch (c.category) {
    case 'platform':
      return `Platforms like ${c.name} are driven by code or API calls, so your agent probably exists as configuration you can read back plus tools and webhooks you wrote. ${CALLDESK_NAME} flows use their own steps, so expect to translate each prompt and tool into a step rather than import a file.`;
    case 'no-code-builder':
      return `${c.name} is edited in its own builder, so the agent may exist just inside the product and the move is a rebuild by hand. In ${CALLDESK_NAME}, start from an agent template and use test calls to check each branch.`;
    case 'enterprise':
      return `${c.name} is aimed at larger organisations. If you are on a written agreement with it, read the notice and data-return terms before you pick a cut-over date. ${CALLDESK_NAME} is self-serve, billed per minute${BILLING.noMonthlyMinimum ? ' with no monthly minimum' : ''}${BILLING.cancelAnytime ? ' and cancellable any time' : ''}.`;
    case 'model-vendor':
      return `${c.name} supplies speech or language components that teams assemble into their own agent, so what you hold may be your own code around its API. ${CALLDESK_NAME} is a packaged phone agent with plans, so the move replaces that orchestration with a flow.`;
    default:
      return `Check how ${c.name} stores your agent (settings in an editor, or files and API objects) before you decide how much of it you can reuse in ${CALLDESK_NAME}.`;
  }
}

/** The "Your phone numbers" section: what the competitor says, then the real options on the Calldesk side. */
export function phoneNumberBlocks(c: Competitor, providedNumbers: string | null): Block[] {
  const sip = usesSip(c);
  const blocks: Block[] = [{ kind: 'h2', text: 'Your phone numbers' }];
  blocks.push({ kind: 'p', text: providedNumbers ? `What ${poss(c.name)} pages say about numbers: ${sentence(providedNumbers)}` : `We did not find a statement about phone numbers on the ${c.name} pages we read, so ask ${c.name} who holds yours.` });
  if (sip) {
    blocks.push({ kind: 'p', text: `${c.name} describes SIP trunks, and ${CALLDESK_NAME} does not offer SIP trunking. A number that reaches ${c.name} through a trunk therefore cannot be pointed straight at ${CALLDESK_NAME}. Keep the number with its carrier and forward calls from there, or use one of the other routes below.` });
  } else if (c.telephony.bringYourOwnCarrier === 'unknown') {
    blocks.push({ kind: 'p', text: `We could not tell from ${poss(c.name)} pages whether you can bring your own carrier, so find out first whether your number is one ${c.name} issued or one you own elsewhere.` });
  }
  // Limits the vendor itself states about numbers, porting or export matter to someone leaving. Stated neutrally, with the source.
  const numberLimits = c.limitations.filter((l) => /\bnumbers?\b|\bport|export|carrier|forward|\bSIP\b/i.test(l.claim));
  if (numberLimits.length) blocks.push({ kind: 'p', text: `Limits ${poss(c.name)} pages state about numbers or moving out:` }, { kind: 'list', items: numberLimits.map((l) => ({ text: sentence(l.claim), sourceUrl: l.sourceUrl })) });
  const buy = joinOr(PHONE_NUMBERS.options.map((o) => o.carrier));
  blocks.push({
    kind: 'list',
    items: [
      text(`Forward: keep the number with its carrier, register it in the dashboard at no extra charge, and forward calls to it. This is the easiest route to undo.`),
      text(`Buy a new number from ${buy}, a priced extra.`),
      text(`Port: a dashboard form sends a port-in request to Twilio. Treat it as a later step, not a promise that a number can move.`),
    ],
  });
  return blocks;
}

/** What leaving stops costing, drawn from the competitor's own price notes, plus a pointer to the Calldesk side. */
export function costsBlocks(c: Competitor, calldeskPricingCell: string): Block[] {
  const blocks: Block[] = [{ kind: 'h2', text: 'Comparing costs before you move' }];
  blocks.push({ kind: 'p', text: `${poss(c.name)} own description of its pricing: ${sentence(c.pricing.model)}${c.pricing.headline ? ` Its published starting point: ${sentence(c.pricing.headline)}` : ''}` });
  if (c.pricing.whatIsExtra.length) {
    blocks.push({ kind: 'p', text: `Charges ${poss(c.name)} pages list outside that starting point, which are worth finding on your own invoice:` });
    blocks.push({ kind: 'list', items: c.pricing.whatIsExtra.map((x) => text(sentence(x))) });
  }
  const priceLimits = c.limitations.filter((l) => /pric|contract|annual|concurrent|monthly|per[- ]day|\bcaps?\b/i.test(l.claim) && !/\bnumbers?\b|\bSIP\b|HIPAA|SOC ?2|GDPR|BAA|complian|residency/i.test(l.claim));
  if (priceLimits.length) {
    blocks.push({ kind: 'p', text: `Pricing limits ${poss(c.name)} pages state:` });
    blocks.push({ kind: 'list', items: priceLimits.map((l) => ({ text: sentence(l.claim), sourceUrl: l.sourceUrl })) });
  }
  if (c.pricing.planNotes.length) {
    blocks.push({ kind: 'p', text: `Plan terms ${c.name} lists, which decide what you pay while you run both side by side:` });
    blocks.push({ kind: 'list', items: c.pricing.planNotes.map((x) => text(sentence(x))) });
  }
  if (c.pricing.freeTrial) blocks.push({ kind: 'p', text: `On trial terms, ${c.name} states: ${sentence(c.pricing.freeTrial)} ${CALLDESK_NAME}'s free offer is ${VERIFIED_STATEMENTS.freeOffer}.` });
  blocks.push({ kind: 'p', text: `On the ${CALLDESK_NAME} side: ${lowerFirst(calldeskPricingCell)} Ask both for a month at your own volume with every charge included.` });
  return blocks;
}

/** Steps on the Calldesk side. The wording changes with the kind of product you are leaving. */
export function calldeskSteps(c: Competitor, developerDocs: string, hasIntegrations: boolean): { text: string }[] {
  const first =
    c.category === 'no-code-builder'
      ? 'Create an agent in Calldesk from an agent template, then edit the conversation flow in the flow builder.'
      : c.category === 'platform' || c.category === 'model-vendor'
        ? 'Create an agent in Calldesk, in the dashboard, the API or the MCP server, and lay the conversation out as a flow.'
        : 'Create an agent in Calldesk from an agent template or build the conversation flow in the flow builder.';
  const steps = [
    first,
    'Add what the agent should know to a knowledge base, and connect a Cal.com account if it books appointments.',
    `Choose a plan; the costs section below lists them, and a language other than English needs the ${joinOr(LANGUAGES.nonEnglishTierNames)} voice.`,
    `Connect your number by one of the routes above.`,
    'Run test calls and simulation test cases, then promote the tested version from staging to production. The Live Calls page shows calls in progress, not audio.',
  ];
  if (hasIntegrations) steps.push(`Rebuild your ${c.name} connections with webhooks, the REST API or the MCP server (${developerDocs}).`);
  steps.push(`When calls look right, point your number at the ${CALLDESK_NAME} agent and keep ${c.name} available for a short overlap period.`);
  return steps.map(text);
}

/** The competitor's own described strengths, minus compliance wording, as things to test on the Calldesk side. */
export function keepChecklistBlocks(c: Competitor): Block[] {
  const items = c.strengths.filter((x) => !/HIPAA|SOC ?2|GDPR|BAA|DPA|complian|certif/i.test(x.claim));
  if (!items.length) return [];
  return [
    { kind: 'h2', text: `What ${c.name} does well, to test before you switch` },
    { kind: 'p', text: `These are strengths ${poss(c.name)} own pages describe. Test the ones you rely on in ${CALLDESK_NAME} before you cancel.` },
    { kind: 'list', items: items.map((x) => ({ text: sentence(x.claim), sourceUrl: x.sourceUrl })) },
  ];
}

export function mayNotCarryOverBlocks(c: Competitor): Block[] {
  const blocks: Block[] = [
    { kind: 'h2', text: 'What may not carry over' },
    { kind: 'p', text: `Plan on rebuilding the flow by hand: no automatic import from ${c.name} is described here. Re-check voices, prompts and custom functions afterwards.` },
  ];
  // A vendor's own notice about moving or migrating (for example a platform change with a deadline) is relevant here. Stated neutrally, with its source.
  const notices = c.limitations.filter((l) => /migrat|deadline|sunset|discontinu|end of life|acquired/i.test(l.claim));
  if (notices.length) blocks.push({ kind: 'p', text: `A notice on ${poss(c.name)} own pages that may affect your timing:` }, { kind: 'list', items: notices.map((l) => ({ text: sentence(l.claim), sourceUrl: l.sourceUrl })) });
  if (c.unknowns.length) blocks.push({ kind: 'list', items: c.unknowns.map((u) => text(`Not confirmed about ${c.name}: ${lowerFirst(u)}`)) });
  return blocks;
}
