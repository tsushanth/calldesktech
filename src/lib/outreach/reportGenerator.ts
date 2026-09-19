import { getAnthropicClient } from '@/lib/anthropic';
import type { BenchmarkAggregate } from './benchmarkImport';

// Generates the personalized one-pager for a single outreach lead. The
// benchmark aggregate is passed in (computed from real calldesk_benchmark_runs
// rows, see benchmarkImport.ts) rather than recomputed here, and is the ONLY
// source of comparison numbers the model is given — the system prompt is
// explicit that it must not invent figures beyond what's supplied, since this
// output goes straight to a real prospect.

export interface OutreachLeadInput {
  companyName: string;
  domain?: string | null;
  signalSource: 'job_posting' | 'review_site' | 'tech_fingerprint' | 'manual';
  signalDetail?: string | null;
}

export interface GeneratedReport {
  subject: string;
  html: string;
  text: string;
}

const REPORT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'hook', 'proofParagraph', 'cta'],
  properties: {
    subject: {
      type: 'string',
      description: 'A short, specific, non-spammy email subject line (under 70 characters).',
    },
    hook: {
      type: 'string',
      description:
        "1-2 sentences opening the email, tied specifically to the lead's signal (why we're reaching out to THEM specifically), not generic.",
    },
    proofParagraph: {
      type: 'string',
      description:
        'A short paragraph presenting the comparison evidence using ONLY the benchmark numbers provided — must not invent numbers.',
    },
    cta: {
      type: 'string',
      description: 'One sentence, low-friction call to action (e.g. book a 15-minute call, or try the live comparison tool).',
    },
  },
} as const;

const SYSTEM_PROMPT = `You write short, specific, non-hypey B2B outreach emails for Calldesk (calldesk.tech), a lower-cost alternative to Retell AI for building AI voice agents. Calldesk's differentiator: custom-trained, low-latency voice models that can run on CPU instead of GPU, cutting cost without compromising quality — proven via a blind, judge-scored side-by-side benchmark against Retell.

Rules:
- Never invent or round up numbers beyond what is given in the benchmark data provided.
- Be concrete and specific to the lead's signal, not a generic template.
- No hype words ("revolutionary", "game-changing", "cutting-edge").
- Keep total length short — this is a cold email, not a landing page.
- Do not name-drop the lead's own customers or make claims about their business beyond the signal given.`;

function buildBenchmarkContext(agg: BenchmarkAggregate): string {
  if (agg.totalRuns === 0) {
    return 'No benchmark runs are recorded yet — do not include any comparison numbers; keep the proof paragraph focused on the architecture (CPU-served custom models) instead.';
  }
  const parts = [`Based on ${agg.totalRuns} blind, judge-scored mystery-shopper call comparisons against Retell:`];
  if (agg.winRatePct !== null) parts.push(`- Calldesk won or tied ${agg.winRatePct}% of judged comparisons.`);
  if (agg.avgLatencyDeltaMs !== null) {
    const faster = agg.avgLatencyDeltaMs > 0;
    parts.push(
      `- Average response latency: Calldesk ${Math.round(agg.avgOurLatencyMs ?? 0)}ms vs Retell ${Math.round(agg.avgRetellLatencyMs ?? 0)}ms (Calldesk is ${faster ? 'faster' : 'slower'} by ${Math.abs(Math.round(agg.avgLatencyDeltaMs))}ms on average).`
    );
  }
  if (agg.sampleJudgeQuotes.length) {
    parts.push(`- Sample judge notes:\n${agg.sampleJudgeQuotes.map((q) => `  """${q.slice(0, 400)}"""`).join('\n')}`);
  }
  return parts.join('\n');
}

function signalContext(lead: OutreachLeadInput): string {
  switch (lead.signalSource) {
    case 'job_posting':
      return `They appear to be hiring for a voice-AI-related role${lead.signalDetail ? `: "${lead.signalDetail}"` : ''}.`;
    case 'review_site':
      return `They left a public review of Retell${lead.signalDetail ? `: "${lead.signalDetail}"` : ''}.`;
    case 'tech_fingerprint':
      return `Their website's tech fingerprint shows Retell's widget/SDK in use${lead.signalDetail ? ` (${lead.signalDetail})` : ''}.`;
    default:
      return lead.signalDetail || 'Added manually, no specific public signal recorded.';
  }
}

export async function generateOutreachReport(
  lead: OutreachLeadInput,
  benchmark: BenchmarkAggregate
): Promise<GeneratedReport> {
  const client = getAnthropicClient();

  const userPrompt = [
    `Lead: ${lead.companyName}${lead.domain ? ` (${lead.domain})` : ''}`,
    `Signal: ${signalContext(lead)}`,
    '',
    'Benchmark evidence to use (do not exceed or invent beyond this):',
    buildBenchmarkContext(benchmark),
  ].join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: REPORT_OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }
  if (!raw.trim()) throw new Error('Report model returned no text content');

  const parsed = JSON.parse(raw) as { subject: string; hook: string; proofParagraph: string; cta: string };

  const text = [parsed.hook, '', parsed.proofParagraph, '', parsed.cta].join('\n');
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.6; color: #1a1d29; max-width: 560px;">
      <p>${escapeHtml(parsed.hook)}</p>
      <p>${escapeHtml(parsed.proofParagraph)}</p>
      <p>${escapeHtml(parsed.cta)}</p>
    </div>
  `.trim();

  return { subject: parsed.subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');
}
