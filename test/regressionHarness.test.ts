import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper without types
import { diagnoseMissingLog } from '../scripts/regression/lib.mjs';
import { SCENARIOS } from '../scripts/regression/scenarios.mjs';

const fakeDb = (rows: unknown[]) => ({ select: async () => rows });

describe('regression harness: diagnoseMissingLog', () => {
  it('a row under 5 s with no transcript is a retryable cut-off (deploy/restart mid-call)', async () => {
    const r = await diagnoseMissingLog(fakeDb([{ duration_seconds: 0, transcript: [] }]), 't1', '2026-10-03T20:00:00Z');
    expect(r.retryable).toBe(true);
    expect(r.message).toMatch(/under 5 s/);
  });
  it('no rows at all means the call never reached the engine, not retryable', async () => {
    const r = await diagnoseMissingLog(fakeDb([]), 't1', '2026-10-03T20:00:00Z');
    expect(r.retryable).toBe(false);
    expect(r.message).toMatch(/did the call reach the engine/);
  });
  it('a long row with no transcript is not treated as a cut-off', async () => {
    const r = await diagnoseMissingLog(fakeDb([{ duration_seconds: 40, transcript: null }]), 't1', '2026-10-03T20:00:00Z');
    expect(r.retryable).toBe(false);
  });
});

describe('regression harness: Lite language scenarios', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = (id: string): any => SCENARIOS.find((s) => s.id === id);
  const logOf = (agent: string[], caller: string[] = ['x']) => ({
    transcript: [...agent.map((content) => ({ role: 'assistant', content })), ...caller.map((content) => ({ role: 'user', content }))],
  });
  const langs: Array<[string, string, string, string]> = [
    ['lite-lang-de', 'de', 'Guten Tag, wie kann ich Ihnen helfen? Wir haben bis 18 Uhr geöffnet, vielen Dank.', 'Hello, how can I help you today?'],
    ['lite-lang-es', 'es', 'Hola, ¿en qué puedo ayudarle? Cerramos a las seis, gracias.', 'Hello, how can I help you today?'],
    ['lite-lang-fr', 'fr', 'Bonjour, comment puis-je vous aider ? Nous fermons à dix-huit heures, merci.', 'Hello, how can I help you today?'],
    ['lite-lang-it', 'it', 'Buongiorno, come posso aiutarla? Chiudiamo alle sei, grazie.', 'Hello, how can I help you today?'],
    ['lite-lang-pt', 'pt-BR', 'Olá, como posso ajudar? Fechamos às seis, obrigado.', 'Hello, how can I help you today?'],
  ];
  it.each(langs)('%s publishes language %s, runs only on Lite, and checks the reply language', (id, code, good, bad) => {
    const sc = byId(id);
    expect(sc).toBeDefined();
    expect(sc.liteOnly).toBe(true);
    expect(sc.version.globalSettings.language).toBe(code);
    expect(sc.shopperLanguage).toBe(code.split('-')[0]);
    expect(sc.assert(logOf([good]))).toEqual([]);
    expect(sc.assert(logOf([bad])).length).toBeGreaterThan(0);
  });
  it('lite-lang-en is an English control that must NOT trip on language and runs only on Lite', () => {
    const sc = byId('lite-lang-en');
    expect(sc.liteOnly).toBe(true);
    expect(sc.version.globalSettings.language).toBeUndefined();
    expect(sc.assert(logOf(['Hello, we are open until six. Goodbye.']))).toEqual([]);
    expect(sc.assert(logOf([]), []).length).toBeGreaterThan(0);
  });
});
