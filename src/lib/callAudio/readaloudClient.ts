// Client for ReadAloud AI's hosted MCP server (`generate_sound_effect` tool) — the sanctioned way
// for an outside app to reach the sound-effects backend: a developer API key as a bearer token; the
// key -> identity bridge and billing live on ReadAloud's side (see ReadAloudAI/MCP_AUTH_BRIDGE.md).
// The MCP endpoint is stateless Streamable HTTP, so one JSON-RPC `tools/call` POST returns the
// finished WAV inline. Only ever called at asset-configuration time, never during a live call.

export const SOUND_EFFECT_MIN_SEC = 1;
export const SOUND_EFFECT_MAX_SEC = 12;
const MAX_PROMPT_CHARS = 500;
// ReadAloud's tool polls its GPU worker for up to ~60s before handing back a job id; allow that plus slack.
const DEFAULT_TIMEOUT_MS = 90_000;

export type ReadAloudErrorCode =
  | 'not_configured' | 'invalid_input' | 'unauthorized' | 'payment_required'
  | 'rate_limited' | 'capacity' | 'pending' | 'upstream';

export class ReadAloudError extends Error {
  constructor(public code: ReadAloudErrorCode, message: string, public retryable = false) {
    super(message);
    this.name = 'ReadAloudError';
  }
}

export interface ReadAloudOptions {
  apiKey: string | undefined;
  url: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const KNOWN_TOOL_CODES: Record<string, boolean> = { payment_required: false, rate_limited: true, capacity: true, upstream: true, unauthorized: false };

interface RpcBody {
  error?: { message?: string };
  result?: { isError?: boolean; content?: Array<{ type: string; data?: string; text?: string }> };
}

function parseRpcBody(text: string, contentType: string): RpcBody {
  if (contentType.includes('text/event-stream')) {
    // Take the last `data:` line that parses as JSON.
    const lines = text.split('\n').filter((l) => l.startsWith('data:'));
    for (const l of lines.reverse()) {
      try { return JSON.parse(l.slice(5).trim()); } catch { /* try earlier line */ }
    }
    throw new ReadAloudError('upstream', 'Unreadable event-stream response from ReadAloud.', true);
  }
  try { return JSON.parse(text); } catch { throw new ReadAloudError('upstream', 'Unreadable response from ReadAloud.', true); }
}

export async function generateSoundEffectWav(
  input: { prompt: string; durationSec: number },
  opts: ReadAloudOptions
): Promise<Buffer> {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    throw new ReadAloudError('invalid_input', `Prompt must be 1-${MAX_PROMPT_CHARS} characters.`);
  }
  if (!(input.durationSec >= SOUND_EFFECT_MIN_SEC && input.durationSec <= SOUND_EFFECT_MAX_SEC)) {
    throw new ReadAloudError('invalid_input', `Duration must be ${SOUND_EFFECT_MIN_SEC}-${SOUND_EFFECT_MAX_SEC} seconds.`);
  }
  if (!opts.apiKey) throw new ReadAloudError('not_configured', 'READALOUD_API_KEY is not configured.');

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'generate_sound_effect', arguments: { prompt, duration_sec: input.durationSec } },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new ReadAloudError('upstream', 'Could not reach ReadAloud AI.', true);
  }

  if (res.status === 401 || res.status === 403) throw new ReadAloudError('unauthorized', 'ReadAloud rejected the API key.');
  if (res.status === 402) throw new ReadAloudError('payment_required', 'ReadAloud sound effects require an active subscription.');
  if (res.status === 429) throw new ReadAloudError('rate_limited', 'ReadAloud rate limit hit; retry shortly.', true);
  if (!res.ok) throw new ReadAloudError('upstream', `ReadAloud returned HTTP ${res.status}.`, res.status >= 500);

  const body = parseRpcBody(await res.text(), res.headers.get('content-type') ?? '');
  if (body?.error) throw new ReadAloudError('upstream', `ReadAloud error: ${body.error.message ?? 'unknown'}`, true);

  const result = body?.result;
  const content = Array.isArray(result?.content) ? result.content : [];
  if (result?.isError) {
    const text = content.find((c) => c.type === 'text')?.text ?? '';
    const code = Object.keys(KNOWN_TOOL_CODES).find((c) => text.includes(c));
    if (code) throw new ReadAloudError(code as ReadAloudErrorCode, text, KNOWN_TOOL_CODES[code]);
    throw new ReadAloudError('upstream', text || 'Sound effect generation failed.', true);
  }
  const audio = content.find((c) => c.type === 'audio' && typeof c.data === 'string' && c.data.length > 0);
  if (!audio) {
    // No clip and no error: the tool's "still generating past our poll budget" answer.
    throw new ReadAloudError('pending', 'ReadAloud is still generating this clip; try again in a minute.', true);
  }
  return Buffer.from(audio.data as string, 'base64');
}
