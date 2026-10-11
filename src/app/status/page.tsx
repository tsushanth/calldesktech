import type { Metadata } from 'next';
import { StatusUnavailable, StatusView } from '@/components/status/StatusView';
import { getStatusSnapshot } from '@/lib/status/store';
import type { StatusSnapshot } from '@/lib/status/types';

export const metadata: Metadata = {
  title: 'System status | CallDeskTech',
  description: 'Live status of the CallDeskTech web app, API, call engine and voice service, from real automated checks.',
  robots: { index: true },
};

// Server-rendered and cached for a minute. If the database cannot be read we say so rather than show a guess.
export const revalidate = 60;

export default async function StatusPage() {
  let snapshot: StatusSnapshot | null = null;
  try {
    snapshot = await getStatusSnapshot();
  } catch (err) {
    console.error('[status] page read failed:', err);
  }
  return snapshot ? <StatusView snapshot={snapshot} /> : <StatusUnavailable />;
}
