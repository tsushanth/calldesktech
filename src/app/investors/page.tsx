import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DECK_FONTS_HREF, INVESTOR_SLIDES, investorDeckTodos } from '@/lib/deck/investorSlides';
import { canServeInvestorDeck } from '@/lib/deck/investorAccess';
import DeckViewer from '../deck/DeckViewer';

export const metadata: Metadata = {
  title: 'Calldesk',
  robots: { index: false, follow: false },
};

// Private, link-only. Each investor gets their own ?t= code (kept in the founders' tracker); views are counted by the
// site-wide PostHog pageview, so the code shows who opened it. Without a code the page does not render. In production
// the page also refuses to render while any TODO(...) placeholder remains, so a draft can never go out by accident,
// except for the private INVESTOR_PREVIEW_TOKEN code the founders use to review the hosted draft.
export default async function InvestorsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  if (!canServeInvestorDeck({ t, nodeEnv: process.env.NODE_ENV, previewToken: process.env.INVESTOR_PREVIEW_TOKEN, todoCount: investorDeckTodos().length })) notFound();
  return (
    <main style={{ background: '#E4E9F1', minHeight: '100vh' }}>
      <link rel="stylesheet" href={DECK_FONTS_HREF} />
      <style>{`.deck-slide > section{position:relative;width:1920px;height:1080px;box-sizing:border-box;overflow:hidden}`}</style>
      <DeckViewer slides={INVESTOR_SLIDES} />
    </main>
  );
}
