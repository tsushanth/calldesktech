// The page model. Every page is built as an ordered list of blocks. The React renderer (src/components/library/LibraryPage.tsx)
// and the validator's plain-text extraction (textOf in text.ts) both read the same blocks, so what the validator checks is exactly
// what a visitor reads.

export type PageType = 'compare' | 'alternatives' | 'migrate' | 'industry' | 'use-case';
export type HubType = 'alternatives' | 'migrate' | 'industries' | 'use-cases' | 'compare';

export type Cell = { text: string; sourceUrl?: string };
export type Block =
  | { kind: 'h2'; text: string; id?: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string; tone?: 'note' }
  | { kind: 'verified'; text: string }
  | { kind: 'list'; ordered?: boolean; items: { text: string; sourceUrl?: string }[] }
  | { kind: 'table'; caption: string; columns: string[]; rows: Cell[][] }
  | { kind: 'dialogue'; turns: { speaker: 'caller' | 'agent'; text: string }[] }
  | { kind: 'cards'; items: { title: string; text: string; href?: string; external?: boolean; meta?: string; sourceUrl?: string }[] }
  | { kind: 'links'; title: string; items: { label: string; href: string }[] }
  | { kind: 'faq'; items: { q: string; a: string }[] }
  | { kind: 'sources'; items: { title: string; url: string; retrievedAt: string }[] };

export type Crumb = { name: string; path: string };

export type LibraryPageModel = {
  type: PageType;
  /** The content slug (competitor, industry or use-case). */
  slug: string;
  /** Publish-list key, e.g. "compare:vapi". */
  key: string;
  path: string;
  title: string;
  description: string;
  h1: string;
  lede: string;
  breadcrumbs: Crumb[];
  blocks: Block[];
  /** Competitor pages: the competitor name, used by the validator to attribute sentences. */
  competitorSlug?: string;
  competitorName?: string;
  /** Latest retrievedAt used on the page (competitor pages). */
  lastVerified?: string;
  /** Industry and use-case pages render this as FAQPage JSON-LD. Competitor pages never do. */
  faqJsonLd?: { q: string; a: string }[];
};

export type HubModel = {
  type: HubType;
  path: string;
  title: string;
  description: string;
  h1: string;
  lede: string;
  breadcrumbs: Crumb[];
};
