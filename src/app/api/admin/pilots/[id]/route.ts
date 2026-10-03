import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { computePilotStats, type PilotCall, type PilotRow } from '@/lib/pilots';
import { loadCallsForPilot, loadTenantInfo } from '@/lib/pilotJobs';
import { updatePilot } from '@/lib/pilotActions';

export const dynamic = 'force-dynamic';

// GET /api/admin/pilots/[id] - the pilot, its computed stats and its call list (summary, outcome, sentiment, duration).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getSupabaseAdmin();
  const { data, error } = await db.from('calldesk_pilots').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to load pilot' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Pilot not found' }, { status: 404 });
  const pilot = data as unknown as PilotRow;
  const calls: PilotCall[] = await loadCallsForPilot(db, pilot);
  const tenant = (await loadTenantInfo(db, [pilot.tenant_id])).get(pilot.tenant_id);
  return NextResponse.json({ pilot, tenantName: tenant?.name ?? null, stats: computePilotStats(pilot, calls, new Date()), calls });
}

// PATCH /api/admin/pilots/[id] - { action: 'stop' | 'convert' | 'extend' (days?, minutes?) | 'notes' (notes) }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  const res = await updatePilot(getSupabaseAdmin(), id, body as Record<string, unknown>);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ pilot: res.data });
}
