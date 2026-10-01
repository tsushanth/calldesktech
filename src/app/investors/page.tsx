import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DECK_FONTS_HREF, INVESTOR_SLIDES, investorDeckTodos } from '@/lib/deck/investorSlides';
import DeckViewer from '../deck/DeckViewer';

export const metadata: Metadata = {
  title: 'Calldesk',
  robots: { index: false, follow: false },
};

// Private, link-only. Each investor gets their own ?t= code (kept in the founders' tracker); views are counted by the
// site-wide PostHog pageview, so the code shows who opened it. Without a code the page does not render. In production
// the page also refuses to render while any TODO(...) placeholder remains, so a draft can never go out by accident.
export default async function InvestorsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  if (!t || !/^[A-Za-z0-9_-]{3,64}$/.test(t)) notFound();
  if (process.env.NODE_ENV === 'production' && investorDeckTodos().length > 0) notFound();
  return (
    <main style={{ background: '#E4E9F1', minHeight: '100vh' }}>
      <link rel="stylesheet" href={DECK_FONTS_HREF} />
      <style>{`.deck-slide > section{position:relative;width:1920px;height:1080px;box-sizing:border-box;overflow:hidden}`}</style>
      <DeckViewer slides={INVESTOR_SLIDES} />
    </main>
  );
}
