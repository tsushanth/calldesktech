import { getSupabaseAdmin } from '@/lib/supabase';
import { listPublishedSamples, type SampleListItem } from '@/lib/outreach/samples';
import DemoSelection from './DemoSelection';

// Published sample calls change as they are approved, so read them per request.
export const dynamic = 'force-dynamic';

export default async function DemoPage() {
  let samples: SampleListItem[] = [];
  try {
    samples = await listPublishedSamples(getSupabaseAdmin());
  } catch {
    samples = [];
  }
  return <DemoSelection samples={samples} />;
}
