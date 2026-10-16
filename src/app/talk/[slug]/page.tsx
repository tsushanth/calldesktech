import type { Metadata } from 'next';
import TalkClient from './TalkClient';

// A private demo link built for one prospect: not indexed, not listed anywhere, and the slug is the secret.
export const metadata: Metadata = { title: 'Talk to the demo | CallDeskTech', robots: { index: false, follow: false } };

export default async function TalkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TalkClient slug={slug} />;
}
