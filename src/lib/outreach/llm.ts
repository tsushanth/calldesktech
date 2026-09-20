import { spawnSync } from 'child_process';

// Backend switch for the outreach pipeline's two model calls (search + draft).
//   default            : Anthropic API (used on Fly; needs ANTHROPIC_API_KEY)
//   OUTREACH_LLM=cli   : the local `claude` CLI, using its logged-in OAuth
//                        account (used by the Mac mini harness; no API key).
// The CLI path is text-in/text-out with a hard timeout and a tool allowlist,
// so it can search the web but cannot touch files or run commands.

export function usingCli(): boolean {
  return process.env.OUTREACH_LLM === 'cli';
}

export function cliComplete(prompt: string, opts: { webSearch?: boolean; maxTurns?: number; timeoutMs?: number } = {}): string {
  const args = ['-p', '--output-format', 'text', '--model', process.env.OUTREACH_CLI_MODEL || 'sonnet', '--max-turns', String(opts.maxTurns ?? 3)];
  args.push('--allowedTools', opts.webSearch ? 'WebSearch' : 'Read');

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
