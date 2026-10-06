import type { Metadata } from 'next';
import { DECK_FONTS_HREF, DECK_SLIDES } from '@/lib/deck/slides';
import { headers } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { clientIpFrom } from '@/lib/outreach/sampleEvents';
import { recordPageView } from '@/lib/outreach/deckEvents';
import DeckViewer from './DeckViewer';

export const metadata: Metadata = {
  title: 'Calldesk deck',
  robots: { index: false, follow: false },
};

// Public, link-only page. A view with a valid ?t= token is recorded in calldesk_outreach_deck_events (deduped per message per hour,
// bots and mail scanners dropped); the site-wide PostHog pageview still fires as well.
export default async function DeckPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const sp = await searchParams;
  const token = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  if (token) {
    const h = await headers();
    await recordPageView(getSupabaseAdmin(), { token, event: 'view', userAgent: h.get('user-agent'), ip: clientIpFrom(h) });
  }
  return (
    <main style={{ background: '#E4E9F1', minHeight: '100vh' }}>
      <link rel="stylesheet" href={DECK_FONTS_HREF} />
      <style>{`.deck-slide > section{position:relative;width:1920px;height:1080px;box-sizing:border-box;overflow:hidden}`}</style>
      <DeckViewer slides={DECK_SLIDES} />
    </main>
  );
}
