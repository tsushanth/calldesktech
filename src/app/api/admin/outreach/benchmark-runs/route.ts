import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdminSession } from '@/lib/outreach/adminAuth';
import { importBenchmarkRun } from '@/lib/outreach/benchmarkImport';

// POST /api/admin/outreach/benchmark-runs — { stdout, runAt?, sourceRunId? }
// One-time (and ongoing) backfill path: paste the full stdout of a
// mystery-shopper-judge.mjs run here to persist it as a structured
// calldesk_benchmark_runs row. Manual by design for now — see the plan's
// note that wiring mystery-shopper-run.sh to POST here automatically is a
// follow-up, not done in this pass.
export async function POST(request: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  if (!body.stdout || typeof body.stdout !== 'string') {
    return NextResponse.json({ error: 'stdout (string) is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  try {
    const run = await importBenchmarkRun(supabase, {
      stdout: body.stdout,
      runAt: body.runAt ? new Date(body.runAt) : undefined,
      sourceRunId: body.sourceRunId,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    console.error('Error importing benchmark run:', error);
    const message = error instanceof Error ? error.message : 'Failed to import benchmark run';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
