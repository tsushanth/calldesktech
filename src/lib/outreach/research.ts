import { cliComplete, extractJson } from './llm';
import { hostOf } from './discovery/findDomain';

// Research stage: a restricted Claude agent (web fetch/search only, no files,
// no shell) reads an agency's own site and writes a short dossier. Draft
// personalization may only use what is in the dossier, and the dossier is only
// trusted if it cites pages on the agency's own domain.

export type Fit = 'high' | 'medium' | 'low' | 'unclear';

export interface Dossier {
  summary: string;
  services: string[];
  verticals: string[];
  platforms: string[];
  fit: Fit;
  fit_reason: string;
  hook: string | null;
  sources: string[];
}

export interface ResearchInput {
  name: string;
  domain: string;
  description?: string | null;
}

const PROMPT = (i: ResearchInput) => `You are researching a company to decide whether it is a good partner prospect for Calldesk, an AI voice-agent platform that agencies can resell with a revenue share.

Company: ${i.name}
Website: https://${i.domain}
${i.description ? `Listing blurb: ${i.description}\n` : ''}
Fetch the homepage and at most 3 other pages on that same site (services, about, case studies, pricing). Use ONLY what you actually read on those pages. Do not guess or fill gaps from memory.

Return ONLY a JSON object with these keys:
- summary: 1-2 factual sentences on what the company does
- services: array of up to 6 short strings
- verticals: array of industries/customer types they serve (empty if not stated)
- platforms: array of voice/AI platforms or tools they mention using (e.g. Vapi, Retell, GoHighLevel); empty if none named
- fit: "high" if they clearly build or deploy AI voice/phone agents for client businesses; "medium" if they do AI automation/chatbots and voice is plausible; "low" if they are not an agency or have no AI voice relevance (product company, unrelated business, or a competing platform); "unclear" if the site could not be read
- fit_reason: one sentence
- hook: ONE specific, verifiable detail from their site worth mentioning in an email (a named vertical, integration, or offer), or null
- sources: the exact URLs you fetched

No commentary, no markdown fences.`;

const FITS: Fit[] = ['high', 'medium', 'low', 'unclear'];
const strArr = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, max) : [];

export function normalizeDossier(raw: unknown, domain: string): Dossier {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const own = (u: string) => {
    const h = hostOf(u);
    return !!h && (h === domain || h.endsWith(`.${domain}`));
  };
  const sources = strArr(o.sources, 6).filter(own);
  const fit = FITS.includes(o.fit as Fit) ? (o.fit as Fit) : 'unclear';
  // Unverifiable claims are discarded: no cited page on their domain means no hook and no confident fit.
  const trusted = sources.length > 0;
  return {
    summary: typeof o.summary === 'string' ? o.summary.trim().slice(0, 400) : '',
    services: strArr(o.services, 6),
    verticals: strArr(o.verticals, 6),
    platforms: strArr(o.platforms, 6),
    fit: trusted ? fit : 'unclear',
    fit_reason: typeof o.fit_reason === 'string' ? o.fit_reason.trim().slice(0, 300) : '',
    hook: trusted && typeof o.hook === 'string' && o.hook.trim() ? o.hook.trim().slice(0, 240) : null,
    sources,
  };
}

export function researchAgency(input: ResearchInput): Dossier {
  const text = cliComplete(PROMPT(input), { tools: 'WebFetch WebSearch', maxTurns: 12, timeoutMs: 300_000 });
  const parsed = extractJson<unknown>(text, 'object');
  if (!parsed) throw new Error('Research reply was not valid JSON');
  return normalizeDossier(parsed, input.domain);
}
