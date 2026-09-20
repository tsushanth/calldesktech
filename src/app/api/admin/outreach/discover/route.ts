import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isCronRequest, requireAdminSession } from '@/lib/outreach/adminAuth';
import { runDiscovery } from '@/lib/outreach/discovery/pipeline';

export const maxDuration = 600;

// POST /api/admin/outreach/discover  { dryRun?, enrichLimit?, draftLimit? }
// Called daily by the GitHub Actions cron (Authorization: Bearer CRON_SECRET)
// or manually by an admin. A run can take minutes and the app's machine
// auto-stops when idle, so the response streams a heartbeat line every few
// seconds (keeps the proxy connection and the machine alive) and ends with a
// single {"summary": ...} line.
export async function POST(request: NextRequest) {
  const authorized = isCronRequest(request) || !!(await requireAdminSession());
  if (!authorized) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const body = await request.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const clamp = (n: unknown, max: number, fallback: number) =>
    Math.min(max, Math.max(0, Number.isFinite(Number(n)) ? Math.floor(Number(n)) : fallback));
  const enrichLimit = clamp(body.enrichLimit, 40, 10);
  const draftLimit = clamp(body.draftLimit, 20, 10);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => controller.enqueue(encoder.encode('{"heartbeat":true}\n')), 5000);
      try {
        const summary = await runDiscovery(getSupabaseAdmin(), { dryRun, enrichLimit, draftLimit });
        controller.enqueue(encoder.encode(JSON.stringify({ summary }) + '\n'));
      } catch (error) {
        controller.enqueue(encoder.encode(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n'));
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}
