import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LibraryPageView, HubView, type HubItem } from '@/components/library/LibraryPage';
import { findPage, hubModel, pageIsPublished, pagesOfType } from '@/lib/seoLibrary';
import { metadataFor } from '@/lib/seoLibrary/seo';
import type { HubType, LibraryPageModel, PageType } from '@/lib/seoLibrary/model';

// Shared by the /alternatives, /migrate, /industries, /use-cases and /compare/calldesk-vs-* routes.

export const segmentOf = (p: LibraryPageModel) => p.path.split('/').pop() as string;

/** Every page is generated at build time (published or not); an unknown segment is a 404. */
export function staticSegments(type: PageType): { slug: string }[] {
  return pagesOfType(type).map((p) => ({ slug: segmentOf(p) }));
}

export async function pageMetadata(type: PageType, params: Promise<{ slug: string }>): Promise<Metadata> {
  const { slug } = await params;
  const page = findPage(type, slug);
  if (!page) return {};
  return metadataFor(page, pageIsPublished(page));
}

export async function PageRoute({ type, params }: { type: PageType; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = findPage(type, slug);
  if (!page) notFound();
  return <LibraryPageView page={page} indexed={pageIsPublished(page)} />;
}

const HUB_EMPTY: Record<Exclude<HubType, 'compare'>, string> = {
  alternatives: 'The first alternatives guides are being reviewed and will be listed here when they are published.',
  migrate: 'The first migration guides are being reviewed and will be listed here when they are published.',
  industries: 'The first industry pages are being reviewed and will be listed here when they are published.',
  'use-cases': 'The first use-case pages are being reviewed and will be listed here when they are published.',
};

export function hubMetadata(hub: Exclude<HubType, 'compare'>): Metadata {
  const h = hubModel(hub);
  return metadataFor(h.model, h.indexed);
}

export function HubRoute({ hub }: { hub: Exclude<HubType, 'compare'> }) {
  const h = hubModel(hub);
  const items: HubItem[] = h.children.map((p) => ({ href: p.path, title: p.h1, text: p.lede.length > 150 ? `${p.lede.slice(0, 147).trimEnd()}...` : p.lede }));
  return <HubView hub={h.model} items={items} indexed={h.indexed} emptyNote={HUB_EMPTY[hub]} />;
}
