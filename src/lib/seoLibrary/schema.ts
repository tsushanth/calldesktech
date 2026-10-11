import { z } from 'zod';

// Schemas for the programmatic comparison and content library. The JSON files in src/content/{competitors,industries,use-cases}
// are written by researchers and content writers; these schemas are the contract. A file that does not match fails the build
// (see load.ts), so a page can never render from half-shaped data.
//
// Public repo: nothing private, no costs or margins, in any content file.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'not a real date');
const httpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), 'must be an http(s) URL');
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and hyphens only');
const text = z.string().trim().min(1, 'must not be empty');
const stated = z.enum(['stated', 'not-stated']);

export const SourcedClaim = z.object({ claim: text, sourceUrl: httpUrl });

export const CompetitorSchema = z.object({
  slug,
  name: text,
  url: httpUrl,
  status: z.enum(['active', 'unclear', 'inactive']),
  retrievedAt: isoDate,
  category: text,
  positioning: text,
  pricing: z.object({
    model: text,
    headline: z.string().trim(),
    perMinuteUsd: z.number().nonnegative().nullable(),
    currency: text,
    planNotes: z.array(text),
    freeTrial: z.string().trim().nullable().transform((v) => v ?? ''), // null = not stated
    whatIsExtra: z.array(text),
    sourceUrls: z.array(httpUrl),
  }),
  strengths: z.array(SourcedClaim),
  limitations: z.array(SourcedClaim),
  integrations: z.array(text),
  compliance: z.object({ hipaa: stated, soc2: stated, gdpr: stated, note: z.string().trim(), sourceUrl: httpUrl.nullable().transform((v) => v ?? undefined) }),
  telephony: z.object({
    bringYourOwnCarrier: z.enum(['yes', 'no', 'unknown']),
    // Researchers may write prose or a boolean; both render. An empty string means unknown.
    providedNumbers: z.union([z.string().trim(), z.boolean()]),
    sourceUrl: httpUrl.nullable().transform((v) => v ?? undefined),
  }),
  migration: z.object({
    exportAgentsPossible: z.union([z.boolean(), z.string().trim(), z.null()]),
    stepsToLeave: z.array(text),
    sourceUrls: z.array(httpUrl),
  }),
  bestFor: z.string().trim(),
  sources: z.array(z.object({ url: httpUrl, title: text, retrievedAt: isoDate })).min(1),
  unknowns: z.array(text),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

const dialogue = z.array(z.object({ speaker: z.enum(['caller', 'agent']), text })).min(2);
const faq = z.array(z.object({ q: text, a: text }));
const featuresUsed = z.array(z.object({ feature: text, howItHelps: text })).min(1);

const contentBase = {
  slug,
  name: text,
  h1: text,
  metaDescription: text,
  intro: text,
  sampleCallFlow: dialogue,
  featuresUsed,
  considerations: z.array(text),
  faq,
  relatedSlugs: z.array(slug),
};

export const IndustrySchema = z.object({
  ...contentBase,
  callTypes: z.array(text).length(6),
  setupSteps: z.array(text).length(5),
  faq: faq.length(5),
  relatedSlugs: z.array(slug).length(4),
});
export type Industry = z.infer<typeof IndustrySchema>;

export const UseCaseSchema = z.object({
  ...contentBase,
  steps: z.array(text).min(3),
  relatedSlugs: z.array(slug).min(1),
});
export type UseCase = z.infer<typeof UseCaseSchema>;

export const PublishSchema = z.object({ published: z.array(z.string().regex(/^(?:(?:compare|alternatives|migrate|industries|use-cases):)?[a-z0-9]+(?:-[a-z0-9]+)*$/)) });
export type PublishList = z.infer<typeof PublishSchema>;
