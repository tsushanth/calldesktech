import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { computePilotStats } from '@/lib/pilots';
import { loadPilots } from '@/lib/pilotJobs';
import { createPilot } from '@/lib/pilotActions';

export const dynamic = 'force-dynamic';

// GET /api/admin/pilots - every pilot with computed usage. Admin session only (ADMIN_EMAILS), like the other /api/admin routes.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  try {
    const { rows, missingTable } = await loadPilots(getSupabaseAdmin());
    return NextResponse.json({
      migrationApplied: !missingTable,
      pilots: rows.map(({ pilot, tenantName, tenantBlocked, calls }) => ({ pilot, tenantName, tenantBlocked, stats: computePilotStats(pilot, calls, now) })),
    });
  } catch (err) {
    console.error('[admin/pilots] list failed:', err);
    return NextResponse.json({ error: 'Failed to load pilots' }, { status: 500 });
  }
}

// POST /api/admin/pilots - { tenant_id | owner_email, company?, contact_name?, contact_email?, vertical?, minutes_cap?, days?, notes? }
export async function POST(request: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  const res = await createPilot(getSupabaseAdmin(), body as Record<string, unknown>);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ pilot: res.data }, { status: 201 });
}
