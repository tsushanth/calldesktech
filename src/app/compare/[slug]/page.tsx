import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { COMPETITORS, getCompetitor } from '@/lib/compareData';
import { CompetitorTemplate } from '@/components/compare/CompetitorTemplate';
import { PageRoute, pageMetadata, staticSegments } from '@/components/library/route';

// /compare/<slug> has two kinds of pages:
//  - the hand-written competitor entries in src/lib/compareData.ts (slug "vapi", "bland-ai", ...)
//  - the generated, sourced pages from the programmatic library (slug "calldesk-vs-<competitor>", src/lib/seoLibrary)
// A slug starting "calldesk-vs-" belongs to the library; anything else is the original behaviour, unchanged.
const LIBRARY_PREFIX = 'calldesk-vs-';

export const dynamicParams = false;

export function generateStaticParams() {
  return [...COMPETITORS.map((c) => ({ slug: c.slug })), ...staticSegments('compare')];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (slug.startsWith(LIBRARY_PREFIX)) return pageMetadata('compare', params);
  const entry = getCompetitor(slug);
  if (!entry) return {};
  return { title: entry.metaTitle, description: entry.metaDescription };
}

export default async function CompetitorComparePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug.startsWith(LIBRARY_PREFIX)) return <PageRoute type="compare" params={params} />;
  const entry = getCompetitor(slug);
  if (!entry) notFound();
  return <CompetitorTemplate entry={entry} />;
}
