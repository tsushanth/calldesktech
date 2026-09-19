import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { getBenchmarkAggregate } from '@/lib/outreach/benchmarkImport';

// GET /api/admin/outreach/benchmark-summary — the aggregate stats every
// generated report is built from, surfaced on its own so the outreach UI can
// show "here's the evidence we have" before generating anything, and so it's
// obvious when calldesk_benchmark_runs is still empty (no backfill done yet).
export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const aggregate = await getBenchmarkAggregate(supabase);
  return NextResponse.json({ benchmark: aggregate });
}
