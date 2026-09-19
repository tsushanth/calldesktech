import type { SupabaseClient } from '@supabase/supabase-js';

// Parses the stdout produced by realtime-tts/call-loop-poc/scripts/
// mystery-shopper-judge.mjs (a blind A/B judged comparison against Retell)
// into a structured row. That script only ever prints to a terminal today —
// this is the missing link that lets its output become reusable evidence in
// an outreach report instead of being re-typed by hand each time.
//
// Expected input is the FULL stdout of one judge run, including the
// "=== DE-ANONYMIZED ===" footer the script appends (see mystery-shopper-
// judge.mjs) which maps the blind A/B labels back to real system names and
// prints `WINNER_SYSTEM: <label>`.

export interface ParsedBenchmarkRun {
  winner: 'ours' | 'retell' | 'tie' | 'unknown';
  judgeSummary: string;
  transcriptA: string | null;
  transcriptB: string | null;
  ourLatencyMs: number | null;
  retellLatencyMs: number | null;
}

// The two labels the mystery-shopper scripts use for "our" system today —
// see call-loop-poc/README.md ("ttsBackend":"elevenlabs" style tags) and
// MYSTERY_SHOPPER_DECISIONS.md ("call-loop-poc"). Kept as a small allowlist
// rather than a strict enum since the judge script prints whatever label
// string the caller passed it for our side.
const OURS_LABELS = ['call-loop-poc', 'ours', 'calldesk'];

function normalizeWinner(rawLabel: string | null): ParsedBenchmarkRun['winner'] {
  if (!rawLabel) return 'unknown';
  const lower = rawLabel.toLowerCase();
  if (lower.includes('retell')) return 'retell';
  if (OURS_LABELS.some((l) => lower.includes(l))) return 'ours';
  if (lower.includes('tie')) return 'tie';
  return 'unknown';
}

export function parseJudgeOutput(stdout: string): ParsedBenchmarkRun {
  const winnerSystemMatch = stdout.match(/WINNER_SYSTEM:\s*(.+)/i);
  const winner = normalizeWinner(winnerSystemMatch ? winnerSystemMatch[1].trim() : null);

  // Everything from "## Verdict" up to (not including) "## Call A transcript"
  // is the judge's actual reasoning — the part worth quoting in a report.
  const verdictMatch = stdout.match(/## Verdict[\s\S]*?(?=## Call A transcript|$)/i);
  const judgeSummary = (verdictMatch ? verdictMatch[0] : stdout).trim();

  const transcriptAMatch = stdout.match(/## Call A transcript\n([\s\S]*?)(?=\n## Call A timing metrics|\n## Call B transcript|$)/i);
  const transcriptBMatch = stdout.match(/## Call B transcript\n([\s\S]*?)(?=\n## Call B timing metrics|$)/i);

  // llmTtfbMs/ttsLegMs/responseMs are logged per-turn by call-loop-poc's
  // server.js as `[latency] ...responseMs":NNN`; the judge's own "timing
  // metrics" sections just pass through whatever was fed to it. Pull the
  // last (most representative, end-of-call) responseMs for each side if
  // present — best-effort only, latency fields stay null when absent rather
  // than guessing.
  const responseMsMatches = [...stdout.matchAll(/"responseMs":(\d+)/g)].map((m) => Number(m[1]));
  const [ourLatencyMs, retellLatencyMs] =
    winner === 'unknown' || responseMsMatches.length < 2
      ? [null, null]
      : responseMsMatches.length >= 2
        ? [responseMsMatches[0], responseMsMatches[1]]
        : [null, null];

  return {
    winner,
    judgeSummary,
    transcriptA: transcriptAMatch ? transcriptAMatch[1].trim() : null,
    transcriptB: transcriptBMatch ? transcriptBMatch[1].trim() : null,
    ourLatencyMs,
    retellLatencyMs,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function importBenchmarkRun(
  supabase: SupabaseClient<any>,
  params: { stdout: string; runAt?: Date; sourceRunId?: string }
) {
  const parsed = parseJudgeOutput(params.stdout);
  const { data, error } = await supabase
    .from('calldesk_benchmark_runs')
    .insert({
      run_at: (params.runAt ?? new Date()).toISOString(),
      our_latency_ms: parsed.ourLatencyMs,
      retell_latency_ms: parsed.retellLatencyMs,
      winner: parsed.winner,
      judge_summary: parsed.judgeSummary,
      transcript_a: parsed.transcriptA,
      transcript_b: parsed.transcriptB,
      source_run_id: params.sourceRunId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export interface BenchmarkAggregate {
  totalRuns: number;
  ourWins: number;
  retellWins: number;
  ties: number;
  winRatePct: number | null;
  avgOurLatencyMs: number | null;
  avgRetellLatencyMs: number | null;
  avgLatencyDeltaMs: number | null; // positive = we're faster
  sampleJudgeQuotes: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getBenchmarkAggregate(supabase: SupabaseClient<any>): Promise<BenchmarkAggregate> {
  const { data, error } = await supabase
    .from('calldesk_benchmark_runs')
    .select('winner, our_latency_ms, retell_latency_ms, judge_summary')
    .order('run_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  const runs = data ?? [];

  const totalRuns = runs.length;
  const ourWins = runs.filter((r) => r.winner === 'ours').length;
  const retellWins = runs.filter((r) => r.winner === 'retell').length;
  const ties = runs.filter((r) => r.winner === 'tie').length;

  const latencyPairs = runs.filter(
    (r) => typeof r.our_latency_ms === 'number' && typeof r.retell_latency_ms === 'number'
  );
  const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

  const avgOurLatencyMs = avg(latencyPairs.map((r) => r.our_latency_ms as number));
  const avgRetellLatencyMs = avg(latencyPairs.map((r) => r.retell_latency_ms as number));

  return {
    totalRuns,
    ourWins,
    retellWins,
    ties,
    winRatePct: totalRuns ? Math.round((ourWins / totalRuns) * 100) : null,
    avgOurLatencyMs,
    avgRetellLatencyMs,
    avgLatencyDeltaMs:
      avgOurLatencyMs !== null && avgRetellLatencyMs !== null ? avgRetellLatencyMs - avgOurLatencyMs : null,
    sampleJudgeQuotes: runs
      .map((r) => r.judge_summary as string)
      .filter(Boolean)
      .slice(0, 3),
  };
}
