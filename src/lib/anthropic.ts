import Anthropic from '@anthropic-ai/sdk';

// Lazy singleton, mirroring getSupabaseAdmin()/getRetellClient() in this repo:
// nothing is constructed (and no env var is read) until the first call, so
// importing this module never throws at build/import time.
let anthropicClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

// Model used for post-call QA scoring. Defaults to Claude Opus 5; override via
// CALL_QA_MODEL (e.g. a cheaper model for a high call volume) without a code
// change — QA runs once per call, so this is the main cost lever.
export function getCallQaModel(): string {
  return process.env.CALL_QA_MODEL || 'claude-opus-5';
}
