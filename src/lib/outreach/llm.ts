import { spawnSync } from 'child_process';

// Backend switch for the outreach pipeline's two model calls (search + draft).
//   default                 : Anthropic API (used on Fly; needs ANTHROPIC_API_KEY)
//   OUTREACH_LLM=cli        : the local `claude` CLI, using its logged-in OAuth
//                             account (used by the Mac mini harness; no API key).
//   OUTREACH_API_KEY set    : any OpenAI-compatible chat-completions endpoint
//                             (OpenRouter by default), on OUTREACH_MODEL. This
//                             is the cheap path for bulk drafting; the Anthropic
//                             branch stays as the fallback when it is unset.
// The CLI path is text-in/text-out with a hard timeout and a tool allowlist,
// so it can search the web but cannot touch files or run commands.

export function usingCli(): boolean {
  return process.env.OUTREACH_LLM === 'cli';
}

// OpenAI-compatible endpoint config. OPENROUTER_API_KEY is accepted as an alias
// so the KK harness env file works here unchanged.
export const API_BASE = process.env.OUTREACH_API_BASE || 'https://openrouter.ai/api/v1';
export const API_KEY = process.env.OUTREACH_API_KEY || process.env.OPENROUTER_API_KEY || '';
export const API_MODEL = process.env.OUTREACH_MODEL || 'deepseek/deepseek-v4-flash';

export function usingApi(): boolean {
  return Boolean(API_KEY);
}

export async function apiComplete(
  prompt: string,
  opts: { system?: string; model?: string; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (!API_KEY) throw new Error('No OUTREACH_API_KEY or OPENROUTER_API_KEY configured');
  const model = opts.model || API_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech',
        'X-Title': 'Calldesk Outreach',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        messages: [
          ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Outreach API HTTP ${res.status} for ${model}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data.error?.message) throw new Error(`Outreach API error for ${model}: ${data.error.message}`);
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new Error(`Outreach API (${model}) returned no text content`);
    return content.trim();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Outreach API request to ${model} timed out after ${opts.timeoutMs ?? 120_000}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function cliComplete(prompt: string, opts: { webSearch?: boolean; tools?: string; maxTurns?: number; timeoutMs?: number } = {}): string {
  const args = ['-p', '--output-format', 'text', '--model', process.env.OUTREACH_CLI_MODEL || 'sonnet', '--max-turns', String(opts.maxTurns ?? 3)];
  args.push('--allowedTools', opts.tools ?? (opts.webSearch ? 'WebSearch' : 'Read'));

  const result = spawnSync(process.env.CLAUDE_BIN || 'claude', args, {
    input: prompt,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 240_000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });

  if (result.error) throw new Error(`claude CLI failed to run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`claude CLI exited ${result.status}: ${(result.stderr || result.stdout || '').slice(0, 300)}`);
  const out = (result.stdout || '').trim();
  if (/^Not logged in/i.test(out)) throw new Error('claude CLI is not logged in for this session');
  return out;
}

// Pull the first JSON value of the wanted shape out of free text.
export function extractJson<T = unknown>(text: string, kind: 'array' | 'object'): T | null {
  const open = kind === 'array' ? '[' : '{';
  const close = kind === 'array' ? ']' : '}';
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
