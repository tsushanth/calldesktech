import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import { computePilotStats, type PilotRow } from '@/lib/pilots';
import { loadCallsForPilot, loadTenantInfo } from '@/lib/pilotJobs';
import { PilotDetail } from '../PilotsView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pilot | CallDeskTech' };

export default async function PilotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getSupabaseAdmin();
  const { data } = await db.from('calldesk_pilots').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const pilot = data as unknown as PilotRow;
  const now = new Date();
  const calls = await loadCallsForPilot(db, pilot);
  const tenant = (await loadTenantInfo(db, [pilot.tenant_id])).get(pilot.tenant_id);
  return <PilotDetail pilot={pilot} tenantName={tenant?.name ?? null} stats={computePilotStats(pilot, calls, now)} calls={calls} now={now.getTime()} />;
}
