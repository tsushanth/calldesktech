import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { COMPETITORS, getCompetitor } from '@/lib/compareData';
import { CompetitorTemplate } from '@/components/compare/CompetitorTemplate';

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
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
  const entry = getCompetitor(slug);
  if (!entry) notFound();
  return <CompetitorTemplate entry={entry} />;
}
