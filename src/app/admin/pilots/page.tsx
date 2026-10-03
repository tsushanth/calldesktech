import { getSupabaseAdmin } from '@/lib/supabase';
import { computePilotStats } from '@/lib/pilots';
import { loadPilots } from '@/lib/pilotJobs';
import { CreatePilotForm } from './PilotActions';
import { PilotList } from './PilotsView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pilots | CallDeskTech' };

export default async function PilotsPage() {
  const now = new Date();
  const { rows, missingTable } = await loadPilots(getSupabaseAdmin());
  const items = rows.map(({ pilot, tenantName, calls }) => ({ pilot, tenantName, stats: computePilotStats(pilot, calls, now) }));
  const live = items.filter((i) => i.stats.effectiveStatus === 'active').length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-gray-500">{missingTable ? '' : `${items.length} pilots, ${live} running`}</p>
        {!missingTable && <CreatePilotForm />}
      </div>
      <PilotList items={items} now={now.getTime()} migrationApplied={!missingTable} />
    </div>
  );
}
