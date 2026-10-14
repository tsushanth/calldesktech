import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApi } from '@/lib/openapi';
import { LANGUAGE_VALUES } from '@/lib/languages';

// The API and MCP descriptions must say what the publish route really does for languages: Lite covers English plus five languages
// on Piper, other languages on Lite are refused, and the language list is the real one, not a stale subset.
describe('language wording in the API and MCP descriptions', () => {
  const openapi = JSON.stringify(buildOpenApi('https://example.com'));
  const tools = readFileSync(join(process.cwd(), 'src/lib/mcp/tools.ts'), 'utf8');

  it('OpenAPI lists every supported non-English code, not the old 11', () => {
    for (const c of LANGUAGE_VALUES.filter((v) => v !== 'en')) expect(openapi).toContain(c);
    expect(openapi).toContain('ja');
    expect(openapi).not.toContain('es, fr, pt-BR, it, nl, hi, de, pl, id, ar)');
  });
  it('OpenAPI no longer says every non-English agent is pinned to ElevenLabs, and explains Lite', () => {
    expect(openapi).not.toMatch(/a non-English poc agent is pinned to the ElevenLabs voice/);
    expect(openapi).toMatch(/Lite agent runs on the Piper voice, which speaks English, German, Spanish, French, Italian and Portuguese/);
    expect(openapi).toContain('language_not_supported_on_tier');
  });
  it('the MCP guide builds its language list from the real list and explains Lite', () => {
    expect(tools).not.toContain('non-English poc agents are pinned to the ElevenLabs voice');
    expect(tools).not.toContain("'it', 'nl', 'hi', 'de', 'pl', 'id', 'ar'");
    expect(tools).toContain('language_not_supported_on_tier');
    expect(tools).toContain('LANGUAGE_VALUES');
  });
});
