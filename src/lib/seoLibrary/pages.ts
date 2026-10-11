import {
  BILLING, CALLDESK_CERTIFICATION_ALLOW_LIST, CALLDESK_NAME, CALLDESK_SUPPORT_EMAIL, COMPLIANCE_FACTS, DEVELOPER, EXPERT_BACKUP_FACT,
  INCLUDED_ON_EVERY_PLAN, LANGUAGES, PHONE_NUMBERS, TIERS, TIER_RANGE_LABEL, TIER_SUMMARY_LINE, VERIFIED_STATEMENTS,
} from '@/content/calldeskFacts';
import type { Competitor, Industry, UseCase } from './schema';
import type { Library } from './load';
import type { Block, Cell, Crumb, HubModel, LibraryPageModel, PageType } from './model';
import { MIGRATE_CAP, MIGRATE_PRIORITY, pathFor, paths } from './routes';
import { isPublished, publishKey } from './publish';
import { calldeskSteps, categoryParagraph, usesSip, keepChecklistBlocks, costsBlocks, mayNotCarryOverBlocks, phoneNumberBlocks } from './migrate';
import { alternativesBody, alternativesDescription, alternativesLede } from './alternatives';
import { NOT_STATED, NOT_STATED_CAP, fitDescription, fitTitle, itemLabel, lowerLead, joinList, joinOr, longDate, lowerFirst, poss, sentence } from './helpers';

// Everything a page says about Calldesk comes from src/content/calldeskFacts.ts (imported above). Everything it says about a
// competitor comes from that competitor's JSON. No price, plan name or feature is typed in this file. test/lib/seoLibrary/templates.test.ts
// enforces that by scanning this source for digits and money amounts.

const HOME: Crumb = { name: 'Home', path: '/' };

// ---------------------------------------------------------------- shared pieces built from facts

/** "Lite 2¢, Standard 5¢ and Pro 9¢ per minute" */
const planPriceList = `${joinList(TIERS.map((t) => `${t.name} ${t.priceLabel}`))} per minute`;

const calldeskPricingCell = `Per minute of call time on three plans: ${TIER_SUMMARY_LINE}. ${BILLING.noMonthlyMinimum ? 'No monthly minimum.' : ''} Phone carrier charges are billed separately.`.replace(/\s+/g, ' ').trim();

const phoneNumberCell = `A paid extra on every plan: ${PHONE_NUMBERS.options.map((o) => `${o.carrier} ${o.monthly} plus ${o.inbound}`).join('; ')}. Registering a number you already own costs nothing extra.`;

function tierBullets(): { text: string }[] {
  return TIERS.map((t) => ({
    text: `${t.name} (${t.priceLabel} per minute): ${lowerFirst(sentence(t.tagline))} Suited to ${lowerFirst(sentence(t.whoItsFor))} Voice: ${t.voice}. Response speed: ${t.responseSpeed}. Reasoning: ${t.reasoning}.`,
  }));
}

function costBlocks(): Block[] {
  const tiers = tierBullets();
  return [
    { kind: 'h2', text: 'What Calldesk costs' },
    { kind: 'p', text: `Calldesk charges per minute of call time, with three plans. ${BILLING.noMonthlyMinimum ? 'There is no monthly minimum' : ''}${BILLING.noPerBookingOrTransferFees ? ' and no per-booking or per-transfer fees' : ''}${BILLING.cancelAnytime ? ', and you can cancel any time.' : '.'}` },
    { kind: 'list', items: tiers },
    { kind: 'p', text: `Phone carrier charges are separate. Phone numbers from ${CALLDESK_NAME} are ${lowerFirst(phoneNumberCell)} Outbound calls use your own carrier. ${EXPERT_BACKUP_FACT.label} is an optional extra on ${EXPERT_BACKUP_FACT.tiers} at ${EXPERT_BACKUP_FACT.price}; it ${EXPERT_BACKUP_FACT.summary}.` },
    { kind: 'p', text: `Prices on this page are read from the same source as the live pricing page. Check the pricing page (/pricing) for the current figures before you decide.` },
  ];
}

function languageSentence(): string {
  const rule = LANGUAGES.nonEnglishNeedsStandardOrPro && LANGUAGES.englishOnlyTierNames.length
    ? `; agents in a language other than English need the ${joinOr(LANGUAGES.nonEnglishTierNames)} voice, because the ${joinList(LANGUAGES.englishOnlyTierNames)} voice speaks English only`
    : '';
  return `Calldesk supports ${LANGUAGES.headline}, including English${rule}.`;
}

function developerSentence(): string {
  return `Calldesk has a REST API${DEVELOPER.mcpServer ? ', an MCP server' : ''} and ${DEVELOPER.webhooksSigned ? 'signed ' : ''}webhooks for ${joinList([...DEVELOPER.webhookEvents])} events (${DEVELOPER.docsPath}).`;
}

const certCell = (key: string) => (CALLDESK_CERTIFICATION_ALLOW_LIST.includes(key) ? 'Stated by Calldesk' : 'Not claimed');

const DISCLAIMER = (name: string, date: string) =>
  `Details about ${name} come from its public pages as they were on ${longDate(date)}. ${name} may have changed them since, and a page that was unclear to us may be clear to you. Corrections: ${CALLDESK_SUPPORT_EMAIL}. We make Calldesk, so read this page with that in mind and check anything important with ${name} directly.`;

function sourcesBlock(c: Competitor): Block {
  return { kind: 'sources', items: c.sources.map((s) => ({ title: s.title, url: s.url, retrievedAt: s.retrievedAt })) };
}

function providedNumbersText(c: Competitor): string | null {
  const v = c.telephony.providedNumbers;
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return v ? v : null;
}

function exportText(c: Competitor): string | null {
  const v = c.migration.exportAgentsPossible;
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return typeof v === 'string' && v ? v : null;
}

const statedCell = (v: 'stated' | 'not-stated'): string => (v === 'stated' ? 'Stated on their pages' : NOT_STATED_CAP);

function pubLink(lib: Library, type: PageType, slug: string, label: string): { label: string; href: string } | null {
  return isPublished(lib.publish, type, slug) ? { label, href: pathFor(type, slug) } : null;
}
const present = <T,>(x: T | null): x is T => x !== null;

// ---------------------------------------------------------------- which competitors get which pages

export const activeCompetitors = (lib: Library) => lib.competitors.filter((c) => c.status === 'active');

export function migrationCompetitors(lib: Library): Competitor[] {
  const eligible = activeCompetitors(lib).filter((c) => c.migration.stepsToLeave.length > 0);
  const rank = (s: string) => { const i = MIGRATE_PRIORITY.indexOf(s); return i === -1 ? MIGRATE_PRIORITY.length : i; };
  return [...eligible].sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug)).slice(0, MIGRATE_CAP);
}

/** Other active competitors to list as alternatives: same category first, then shared integrations, then name. */
export function otherAlternatives(lib: Library, c: Competitor, max = 3): Competitor[] {
  const overlap = (o: Competitor) => o.integrations.filter((i) => c.integrations.map((x) => x.toLowerCase()).includes(i.toLowerCase())).length;
  return activeCompetitors(lib)
    .filter((o) => o.slug !== c.slug)
    .sort((a, b) => Number(b.category === c.category) - Number(a.category === c.category) || overlap(b) - overlap(a) || a.name.localeCompare(b.name))
    .slice(0, max);
}

// ---------------------------------------------------------------- compare

function compareRows(c: Competitor): Cell[][] {
  const rows: Cell[][] = [];
  const priceSrc = c.pricing.sourceUrls[0];
  const telSrc = c.telephony.sourceUrl;
  const compSrc = c.compliance.sourceUrl;

  rows.push([{ text: 'How pricing works' }, { text: calldeskPricingCell }, { text: c.pricing.model, sourceUrl: priceSrc }]);
  if (c.pricing.headline) rows.push([{ text: 'Published starting price' }, { text: `${TIER_RANGE_LABEL} per minute depending on the plan, before phone carrier charges` }, { text: c.pricing.headline, sourceUrl: priceSrc }]);
  if (c.pricing.whatIsExtra.length) rows.push([{ text: 'Billed separately or extra' }, { text: `The phone carrier is billed separately unless you buy numbers from us; ${EXPERT_BACKUP_FACT.label} is an optional extra on ${EXPERT_BACKUP_FACT.tiers} at ${EXPERT_BACKUP_FACT.price}` }, { text: c.pricing.whatIsExtra.map((x) => x.replace(/[.;]$/, '')).join('; '), sourceUrl: priceSrc }]);
  if (c.pricing.freeTrial) rows.push([{ text: 'Trying it first' }, { text: 'A free demo call on the Calldesk site' }, { text: c.pricing.freeTrial, sourceUrl: priceSrc }]);
  if (c.telephony.bringYourOwnCarrier !== 'unknown') rows.push([{ text: 'Bring your own carrier' }, { text: PHONE_NUMBERS.bringYourOwnIsFree ? `Yes, on every plan, at no extra charge, by forwarding calls to a number you register${VERIFIED_STATEMENTS.sipTrunking ? '' : ' (no SIP trunking)'}` : 'No' }, { text: c.telephony.bringYourOwnCarrier === 'yes' ? 'Yes' : 'No', sourceUrl: telSrc }]);
  const pn = providedNumbersText(c);
  if (pn) rows.push([{ text: 'Phone numbers from the provider' }, { text: phoneNumberCell }, { text: pn, sourceUrl: telSrc }]);
  rows.push([{ text: 'HIPAA' }, { text: certCell('hipaa') }, { text: statedCell(c.compliance.hipaa), sourceUrl: compSrc }]);
  rows.push([{ text: 'SOC 2' }, { text: certCell('soc2') }, { text: statedCell(c.compliance.soc2), sourceUrl: compSrc }]);
  rows.push([{ text: 'GDPR' }, { text: certCell('gdpr') }, { text: statedCell(c.compliance.gdpr), sourceUrl: compSrc }]);
  if (c.integrations.length) rows.push([{ text: 'Integrations and developer tools' }, { text: `${joinList(['REST API', ...(DEVELOPER.mcpServer ? ['MCP server'] : []), 'signed webhooks'])}, plus calendar booking` }, { text: joinList(c.integrations) }]);
  return rows;
}

function differenceBullets(c: Competitor): { text: string }[] {
  const out: { text: string }[] = [];
  if (c.pricing.whatIsExtra.length) {
    out.push({ text: `Billing: ${poss(c.name)} headline price does not cover ${joinList(c.pricing.whatIsExtra.slice(0, 4).map((x) => lowerLead(itemLabel(x))))}${c.pricing.whatIsExtra.length > 4 ? ' and more' : ''}, which its pages bill separately or as extras (the table above has the details). Calldesk bills one per-minute rate for the plan you choose (${planPriceList}), and the phone carrier is billed separately unless you buy numbers from us. Compare the two on a month of your own calls.` });
  } else {
    out.push({ text: `Billing: Calldesk bills one per-minute rate for the plan you choose (${planPriceList}), with the phone carrier billed separately. We did not find a list of separate charges on ${poss(c.name)} pages, so ask ${c.name} what a month at your volume would include.` });
  }
  const sipNote = VERIFIED_STATEMENTS.sipTrunking ? '' : ` ${CALLDESK_NAME} does not offer SIP trunking${usesSip(c) ? `, which ${poss(c.name)} pages describe` : ''}.`;
  if (c.telephony.bringYourOwnCarrier === 'yes') out.push({ text: `Phone setup: both support bringing your own carrier. With ${CALLDESK_NAME} you register a number you own and forward calls to it.${sipNote} ${CALLDESK_NAME} also sells numbers from ${joinList(PHONE_NUMBERS.options.map((o) => o.carrier))} if you prefer not to bring one.` });
  else if (c.telephony.bringYourOwnCarrier === 'no') out.push({ text: `Phone setup: ${poss(c.name)} pages do not describe bringing your own carrier. Calldesk lets you register a number you own and forward calls to it, at no extra charge on every plan.${sipNote}` });
  else out.push({ text: `Phone setup: we could not tell from ${poss(c.name)} pages whether you can bring your own carrier. On Calldesk you can register a number you own and forward calls to it, on every plan, at no extra charge.${sipNote}` });
  out.push({ text: `Languages: ${languageSentence()}` });
  out.push({ text: `Developer tools: ${developerSentence()}` });
  out.push({ text: `Compliance: ${COMPLIANCE_FACTS.statement}` });
  return out;
}

function compareFitBlocks(c: Competitor): Block[] {
  const theirs = c.bestFor ? `${c.name} may suit you if this describes you: ${lowerFirst(sentence(c.bestFor))}` : `We did not find a statement on ${poss(c.name)} pages about who it is built for.`;
  const ours = TIERS.map((t) => `${t.name} is for ${lowerFirst(sentence(t.whoItsFor))}`);
  return [
    { kind: 'h2', text: `Which one fits` },
    { kind: 'p', text: theirs },
    { kind: 'p', text: `Calldesk may suit you if your calls match one of its plans. ${ours.join(' ')} Current prices are on the pricing page at /pricing.` },
  ];
}

function compareModel(lib: Library, c: Competitor): LibraryPageModel {
  const path = paths.compare(c.slug);
  const date = longDate(c.retrievedAt);
  const lede = `A sourced comparison of ${CALLDESK_NAME} and ${c.name} (${lowerFirst(c.category)}), built from ${poss(c.name)} public pages as of ${date}.`;
  const blocks: Block[] = [
    { kind: 'verified', text: `Last verified ${date}.` },
    { kind: 'p', tone: 'note', text: DISCLAIMER(c.name, c.retrievedAt) },
    { kind: 'h2', text: `About ${c.name}` },
    { kind: 'p', text: `How ${c.name} positions itself: ${sentence(c.positioning)}` },
    { kind: 'h2', text: 'Side by side' },
    { kind: 'p', text: `A row is shown when we could read both sides. Where ${poss(c.name)} pages did not say, a cell reads "${NOT_STATED}" rather than a guess. It rests on published pricing, setup and wording, and does not use call-quality or benchmark results.` },
    { kind: 'table', caption: `${CALLDESK_NAME} and ${c.name} compared`, columns: ['', CALLDESK_NAME, c.name], rows: compareRows(c) },
  ];
  if (c.compliance.note) blocks.push({ kind: 'p', text: `About ${poss(c.name)} compliance wording: ${sentence(c.compliance.note)}` });
  if (c.pricing.planNotes.length) {
    blocks.push({ kind: 'h2', text: `${c.name} pricing details` });
    blocks.push({ kind: 'list', items: c.pricing.planNotes.map((text) => ({ text, sourceUrl: c.pricing.sourceUrls[0] })) });
  }
  if (c.strengths.length) {
    blocks.push({ kind: 'h2', text: `What ${c.name} does well` });
    blocks.push({ kind: 'list', items: c.strengths.map((s) => ({ text: s.claim, sourceUrl: s.sourceUrl })) });
  }
  if (c.limitations.length) {
    blocks.push({ kind: 'h2', text: `Conditions to check with ${c.name}` });
    blocks.push({ kind: 'p', text: 'These are limits or conditions described on the pages we reviewed. We list them so you can check whether they matter for your calls.' });
    blocks.push({ kind: 'list', items: c.limitations.map((s) => ({ text: s.claim, sourceUrl: s.sourceUrl })) });
  }
  blocks.push({ kind: 'h2', text: `Where ${CALLDESK_NAME} is different` }, { kind: 'list', items: differenceBullets(c) });
  blocks.push(...compareFitBlocks(c));
  if (c.unknowns.length) {
    blocks.push({ kind: 'h2', text: `What we could not confirm about ${c.name}` });
    blocks.push({ kind: 'list', items: c.unknowns.map((text) => ({ text })) });
  }
  const related = [
    pubLink(lib, 'alternatives', c.slug, `${c.name} alternatives`),
    lib.competitors.find((x) => x.slug === c.slug) && migrationCompetitors(lib).some((m) => m.slug === c.slug) ? pubLink(lib, 'migrate', c.slug, `Moving from ${c.name} to Calldesk`) : null,
    ...activeCompetitors(lib).filter((o) => o.slug !== c.slug).sort((a, b) => Number(b.category === c.category) - Number(a.category === c.category) || a.name.localeCompare(b.name)).slice(0, 3).map((o) => pubLink(lib, 'compare', o.slug, `${CALLDESK_NAME} vs ${o.name}`)),
  ].filter(present);
  if (related.length) blocks.push({ kind: 'links', title: 'Related pages', items: related });
  blocks.push({ kind: 'h2', text: 'Sources', id: 'sources' }, sourcesBlock(c));
  return {
    type: 'compare', slug: c.slug, key: publishKey('compare', c.slug), path,
    title: fitTitle(`${CALLDESK_NAME} vs ${c.name}: pricing and phone setup`, `${CALLDESK_NAME} vs ${c.name}: pricing and setup`, `${CALLDESK_NAME} vs ${c.name}`),
    description: fitDescription(`Compare ${CALLDESK_NAME} and ${c.name} on pricing, phone setup and compliance wording, using ${poss(c.name)} public pages reviewed ${date}.`, `${CALLDESK_NAME} and ${c.name} compared on pricing, phone setup and compliance wording, from ${poss(c.name)} pages reviewed ${date}.`, `${CALLDESK_NAME} and ${c.name} compared on pricing and phone setup, from ${poss(c.name)} pages reviewed ${date}.`),
    h1: `${CALLDESK_NAME} vs ${c.name}`, lede,
    breadcrumbs: [HOME, { name: 'Compare', path: '/compare' }, { name: `${CALLDESK_NAME} vs ${c.name}`, path }],
    blocks, competitorSlug: c.slug, competitorName: c.name, lastVerified: c.retrievedAt,
  };
}

// ---------------------------------------------------------------- alternatives

function alternativesModel(lib: Library, c: Competitor): LibraryPageModel {
  const path = paths.alternatives(c.slug);
  const date = longDate(c.retrievedAt);
  const { blocks: body, relatedSlugs } = alternativesBody(lib, c, { planPriceList });
  const blocks: Block[] = [
    { kind: 'verified', text: `Last verified ${date}.` },
    { kind: 'p', tone: 'note', text: `We make ${CALLDESK_NAME}, so it appears below as one of the options, and we say so. Options are listed alphabetically, not ranked.` },
    ...body,
  ];
  const related = [
    pubLink(lib, 'compare', c.slug, `${CALLDESK_NAME} vs ${c.name}`),
    migrationCompetitors(lib).some((m) => m.slug === c.slug) ? pubLink(lib, 'migrate', c.slug, `Moving from ${c.name} to Calldesk`) : null,
    ...relatedSlugs.map((s) => pubLink(lib, 'compare', s, `${CALLDESK_NAME} vs ${lib.competitors.find((x) => x.slug === s)?.name ?? s}`)),
  ].filter(present);
  if (related.length) blocks.push({ kind: 'links', title: 'Related pages', items: related });
  blocks.push({ kind: 'p', tone: 'note', text: DISCLAIMER(c.name, c.retrievedAt) });
  blocks.push({ kind: 'h2', text: 'Sources', id: 'sources' }, sourcesBlock(c));
  return {
    type: 'alternatives', slug: c.slug, key: publishKey('alternatives', c.slug), path,
    title: `${c.name} alternatives: what to consider | CallDeskTech`,
    description: alternativesDescription(c, date, relatedSlugs.length),
    h1: `${c.name} alternatives`,
    lede: alternativesLede(c, date),
    breadcrumbs: [HOME, { name: 'Alternatives', path: '/alternatives' }, { name: `${c.name} alternatives`, path }],
    blocks, competitorSlug: c.slug, competitorName: c.name, lastVerified: c.retrievedAt,
  };
}

// ---------------------------------------------------------------- migrate

function migrateModel(lib: Library, c: Competitor): LibraryPageModel {
  const path = paths.migrate(c.slug);
  const date = longDate(c.retrievedAt);
  const exp = exportText(c);
  const before: { text: string }[] = [];
  before.push({ text: exp ? (/^(yes|true)$/i.test(exp) ? `Exporting your agents: ${c.name} documents a way to read your agents back out (the steps below list it).` : /^(no|false)$/i.test(exp) ? `Exporting your agents: ${poss(c.name)} pages say agents cannot be exported, so plan a full rebuild.` : `Exporting your agents: ${poss(c.name)} pages describe it as: ${sentence(exp)}`) : `Exporting your agents: we did not find a statement on ${poss(c.name)} pages about exporting agents, so ask ${c.name} what you can take with you.` });
  if (c.integrations.length) before.push({ text: `Connected tools: list what you connected to ${c.name} (${joinList(c.integrations)}) so you can reconnect each one.` });
  before.push({ text: `Recordings and transcripts: download anything you need to keep from ${c.name} before you cancel.` });

  const steps = calldeskSteps(c, DEVELOPER.docsPath, c.integrations.length > 0);

  const blocks: Block[] = [
    { kind: 'verified', text: `Last verified ${date}.` },
    { kind: 'p', tone: 'note', text: DISCLAIMER(c.name, c.retrievedAt) },
    { kind: 'h2', text: `Moving from ${c.name}: what kind of move this is` },
    { kind: 'p', text: `How ${c.name} positions itself: ${sentence(c.positioning)}` },
    { kind: 'p', text: categoryParagraph(c) },
    ...(c.bestFor ? [{ kind: 'p' as const, text: `${poss(c.name)} pages and our reading of them suggest it fits: ${lowerFirst(sentence(c.bestFor))}` }] : []),
    { kind: 'h2', text: `Before you leave ${c.name}` },
    { kind: 'list', items: before },
    { kind: 'h2', text: `Steps to leave ${c.name}` },
    { kind: 'p', text: `These steps come from ${poss(c.name)} public pages. Sources are listed at the end.` },
    { kind: 'list', ordered: true, items: c.migration.stepsToLeave.map((text) => ({ text, sourceUrl: c.migration.sourceUrls[0] })) },
    ...phoneNumberBlocks(c, providedNumbersText(c)),
    { kind: 'h2', text: `Steps on the ${CALLDESK_NAME} side` },
    { kind: 'list', ordered: true, items: steps },
    ...keepChecklistBlocks(c),
    ...mayNotCarryOverBlocks(c),
    ...costsBlocks(c, calldeskPricingCell),
  ];
  const related = [
    pubLink(lib, 'compare', c.slug, `${CALLDESK_NAME} vs ${c.name}`),
    pubLink(lib, 'alternatives', c.slug, `${c.name} alternatives`),
  ].filter(present);
  if (related.length) blocks.push({ kind: 'links', title: 'Related pages', items: related });
  blocks.push({ kind: 'h2', text: 'Sources', id: 'sources' }, { kind: 'sources', items: c.sources.filter((s) => c.migration.sourceUrls.includes(s.url) || c.pricing.sourceUrls.includes(s.url)).map((s) => ({ title: s.title, url: s.url, retrievedAt: s.retrievedAt })) });
  return {
    type: 'migrate', slug: c.slug, key: publishKey('migrate', c.slug), path,
    title: fitTitle(`Moving from ${c.name} to Calldesk: a checklist`, `Moving from ${c.name} to Calldesk`),
    description: fitDescription(`A checklist for moving from ${c.name} to ${CALLDESK_NAME}: what to export, phone numbers and testing. Based on ${poss(c.name)} pages reviewed ${date}.`, `Moving from ${c.name} to ${CALLDESK_NAME}: what to export, phone numbers and testing, from ${poss(c.name)} pages reviewed ${date}.`, `Moving from ${c.name} to ${CALLDESK_NAME}: what to rebuild, phone numbers, testing. ${poss(c.name)} pages reviewed ${date}.`),
    h1: `Moving from ${c.name} to ${CALLDESK_NAME}`,
    lede: `A step-by-step checklist for teams moving a phone agent from ${c.name} to ${CALLDESK_NAME}, based on ${poss(c.name)} public pages as of ${date}.`,
    breadcrumbs: [HOME, { name: 'Migrate', path: '/migrate' }, { name: `From ${c.name}`, path }],
    blocks, competitorSlug: c.slug, competitorName: c.name, lastVerified: c.retrievedAt,
  };
}

// ---------------------------------------------------------------- industries and use cases

function relatedLinks(lib: Library, slugs: string[], selfSlug: string): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  for (const s of slugs) {
    if (s === selfSlug) continue;
    const ind = lib.industries.find((x) => x.slug === s);
    if (ind && isPublished(lib.publish, 'industry', s)) out.push({ label: ind.name, href: paths.industry(s) });
    const uc = lib.useCases.find((x) => x.slug === s);
    if (uc && isPublished(lib.publish, 'use-case', s)) out.push({ label: uc.name, href: paths.useCase(s) });
  }
  return out;
}

function contentBlocks(lib: Library, d: Industry | UseCase, kind: 'industry' | 'use-case'): Block[] {
  const blocks: Block[] = [];
  if (kind === 'industry') {
    const ind = d as Industry;
    blocks.push({ kind: 'h2', text: `Calls a ${CALLDESK_NAME} agent can handle` }, { kind: 'list', items: ind.callTypes.map((text) => ({ text })) });
  } else {
    const uc = d as UseCase;
    blocks.push({ kind: 'h2', text: 'How it works' }, { kind: 'list', ordered: true, items: uc.steps.map((text) => ({ text })) });
  }
  blocks.push({ kind: 'h2', text: 'A sample call' }, { kind: 'p', tone: 'note', text: 'An illustrative example written for this page. The business in it is fictional, and this is not a recording of a real call.' }, { kind: 'dialogue', turns: d.sampleCallFlow });
  if (kind === 'industry') blocks.push({ kind: 'h2', text: 'How to set it up' }, { kind: 'list', ordered: true, items: (d as Industry).setupSteps.map((text) => ({ text })) });
  blocks.push({ kind: 'h2', text: `Features used` }, { kind: 'list', items: d.featuresUsed.map((f) => ({ text: `${f.feature}: ${f.howItHelps}` })) });
  if (d.featuresUsed.some((f) => /calendar/i.test(f.feature))) blocks.push({ kind: 'p', text: VERIFIED_STATEMENTS.calendar });
  blocks.push({ kind: 'h2', text: 'Things to consider' });
  blocks.push({ kind: 'list', items: [...d.considerations.map((text) => ({ text })), { text: COMPLIANCE_FACTS.statement }] });
  blocks.push(...costBlocks());
  blocks.push({ kind: 'h2', text: 'Common questions' }, { kind: 'faq', items: d.faq });
  const rel = relatedLinks(lib, d.relatedSlugs, d.slug);
  if (rel.length) blocks.push({ kind: 'links', title: 'Related pages', items: rel });
  blocks.push({ kind: 'p', tone: 'note', text: `Included on every plan: ${INCLUDED_ON_EVERY_PLAN.join('; ')}.` });
  return blocks;
}

function industryModel(lib: Library, d: Industry): LibraryPageModel {
  const path = paths.industry(d.slug);
  return {
    type: 'industry', slug: d.slug, key: publishKey('industry', d.slug), path,
    title: fitTitle(d.h1), description: d.metaDescription, h1: d.h1, lede: d.intro,
    breadcrumbs: [HOME, { name: 'Industries', path: '/industries' }, { name: d.name, path }],
    blocks: contentBlocks(lib, d, 'industry'), faqJsonLd: d.faq,
  };
}
function useCaseModel(lib: Library, d: UseCase): LibraryPageModel {
  const path = paths.useCase(d.slug);
  return {
    type: 'use-case', slug: d.slug, key: publishKey('use-case', d.slug), path,
    title: fitTitle(d.h1), description: d.metaDescription, h1: d.h1, lede: d.intro,
    breadcrumbs: [HOME, { name: 'Use cases', path: '/use-cases' }, { name: d.name, path }],
    blocks: contentBlocks(lib, d, 'use-case'), faqJsonLd: d.faq,
  };
}

// ---------------------------------------------------------------- entry points

export function buildPages(lib: Library): LibraryPageModel[] {
  const active = activeCompetitors(lib);
  return [
    ...active.map((c) => compareModel(lib, c)),
    ...active.map((c) => alternativesModel(lib, c)),
    ...migrationCompetitors(lib).map((c) => migrateModel(lib, c)),
    ...lib.industries.map((d) => industryModel(lib, d)),
    ...lib.useCases.map((d) => useCaseModel(lib, d)),
  ];
}

export function hubModels(): Record<'alternatives' | 'migrate' | 'industries' | 'use-cases', HubModel> {
  const mk = (type: HubModel['type'], p: string, name: string, title: string, description: string, h1: string, lede: string): HubModel => ({ type, path: p, title, description, h1, lede, breadcrumbs: [HOME, { name, path: p }] });
  return {
    alternatives: mk('alternatives', '/alternatives', 'Alternatives', 'Voice AI platform alternatives, compared from public pages | CallDeskTech', 'Neutral guides to choosing an alternative to a voice AI platform, each built from the platform\'s public pages with sources and a review date.', 'Voice AI platform alternatives', 'What to consider when choosing an alternative to a voice AI phone platform. Each guide names what the platform does well, lists questions to ask, and shows the options, including Calldesk, which we make.'),
    migrate: mk('migrate', '/migrate', 'Migrate', 'Moving a phone agent to Calldesk: guides by platform | CallDeskTech', 'Checklists for moving a phone agent from another voice AI platform to Calldesk, based on each platform\'s public pages.', 'Moving to Calldesk', 'Checklists for moving a phone agent from another voice AI platform to Calldesk, one guide per platform, each with sources and a review date.'),
    industries: mk('industries', '/industries', 'Industries', 'AI phone agents by industry | CallDeskTech', 'How an AI phone agent handles calls in different industries: call types, a sample call, setup steps and things to consider.', 'AI phone agents by industry', 'How a Calldesk phone agent can handle the calls an industry gets: the call types, a sample conversation, how to set it up and what to consider.'),
    'use-cases': mk('use-cases', '/use-cases', 'Use cases', 'AI phone agent use cases | CallDeskTech', 'Common jobs for an AI phone agent, such as answering, booking and follow-up: how each works, a sample call and what to consider.', 'AI phone agent use cases', 'The jobs people give a Calldesk phone agent, from answering calls to booking: how each one works, a sample call and what to consider.'),
  };
}

export { NOT_STATED };
