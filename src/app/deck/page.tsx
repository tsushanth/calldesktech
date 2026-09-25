import type { Metadata } from 'next';
import { DECK_FONTS_HREF, DECK_SLIDES } from '@/lib/deck/slides';
import DeckViewer from './DeckViewer';

export const metadata: Metadata = {
  title: 'Calldesk deck',
  robots: { index: false, follow: false },
};

// Public, link-only page. Views are counted by the site-wide PostHog pageview (the ?t= token in the
// URL identifies the outreach message), not by the sample-call event table.
export default function DeckPage() {
  return (
    <main style={{ background: '#E4E9F1', minHeight: '100vh' }}>
      <link rel="stylesheet" href={DECK_FONTS_HREF} />
      <style>{`.deck-slide > section{position:relative;width:1920px;height:1080px;box-sizing:border-box;overflow:hidden}`}</style>
      <DeckViewer slides={DECK_SLIDES} />
    </main>
  );
}
