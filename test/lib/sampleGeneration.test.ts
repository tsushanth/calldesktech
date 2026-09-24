import { describe, it, expect, vi } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as lib from '../../scripts/lib/sample-lib.mjs';
import { generate } from '../../scripts/generate-vertical-sample.mjs';

const doc = JSON.parse(readFileSync('scripts/sample-scenarios.json', 'utf8'));

describe('sample scenarios', () => {
  it('validates and covers all 8 verticals', () => {
    expect(lib.validateScenarios(doc)).toEqual([]);
    expect(doc.scenarios.map((s: { id: string }) => s.id).sort()).toEqual([...lib.VERTICALS].sort());
  });
  it('rejects a phone number, missing AI disclosure, and bad product', () => {
    const bad = structuredClone(doc);
    bad.scenarios[0].agentPrompt += ' Call 555-123-4567.';
    bad.scenarios[1].disclosure = 'demo call';
    bad.scenarios[2].product = 'calldesk:other';
    const errs: string[] = lib.validateScenarios(bad);
    expect(errs.some((e) => /phone number/.test(e))).toBe(true);
    expect(errs.some((e) => /disclosure/.test(e))).toBe(true);
    expect(errs.some((e) => /product/.test(e))).toBe(true);
  });
  it('bail bonds agent is told not to give legal advice', () => {
    const b = doc.scenarios.find((s: { id: string }) => s.id === 'bailbonds');
    expect(b.agentPrompt).toMatch(/do NOT give legal advice/);
  });
});

describe('normalizeTranscript', () => {
  it('maps shopper-side roles, strips markers/tone tags, merges same-speaker runs', () => {
    const out = lib.normalizeTranscript([
      { role: 'user', content: '[Call connected — begin the flow.]' },
      { role: 'user', content: 'Halden Ridge, how can I help?' },
      { role: 'assistant', content: 'Hi, about the Dallas load.' },
      { role: 'assistant', content: 'Is it open?' },
      { role: 'user', content: '[tone:upbeat] Yes it is.' },
      { role: 'user', content: '   ' },
    ]);
    expect(out).toEqual([
      { speaker: 'agent', text: 'Halden Ridge, how can I help?' },
      { speaker: 'caller', text: 'Hi, about the Dallas load. Is it open?' },
      { speaker: 'agent', text: 'Yes it is.' },
    ]);
  });
  it('can invert perspective and passes through normalized rows; junk yields []', () => {
    expect(lib.normalizeTranscript([{ role: 'assistant', content: 'hi' }], { shopperPerspective: false })).toEqual([{ speaker: 'agent', text: 'hi' }]);
    expect(lib.normalizeTranscript([{ speaker: 'caller', text: 'x' }])).toEqual([{ speaker: 'caller', text: 'x' }]);
    expect(lib.normalizeTranscript(null)).toEqual([]);
  });
});

describe('pickSnippet', () => {
  const t = [
    { speaker: 'agent', text: 'Halden Ridge Freight, how can I help?' },
    { speaker: 'caller', text: 'Calling about the Dallas to Atlanta load.' },
    { speaker: 'agent', text: 'Sure. Can I get your name and MC number?' },
    { speaker: 'caller', text: 'Marcus, Blue Mesa Hauling.' },
    { speaker: 'agent', text: "Thanks Marcus. The load is still open at twenty-eight fifty. I'll have a broker call you back to confirm." },
    { speaker: 'caller', text: 'Great, thank you.' },
    { speaker: 'agent', text: 'Goodbye.' },
  ];
  it('returns 4-6 ascending unique indexes with greeting, need and the action line', () => {
    const idx: number[] = lib.pickSnippet(t);
    expect(idx.length).toBeGreaterThanOrEqual(4);
    expect(idx.length).toBeLessThanOrEqual(6);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(new Set(idx).size).toBe(idx.length);
    expect(idx).toContain(0);
    expect(idx).toContain(1);
    expect(idx).toContain(4);
  });
  it('is deterministic, in range, and empty for too-short transcripts', () => {
    expect(lib.pickSnippet(t)).toEqual(lib.pickSnippet(t));
    expect(lib.pickSnippet(t.slice(0, 2))).toEqual([]);
    const long = Array.from({ length: 30 }, (_, i) => ({ speaker: i % 2 ? 'caller' : 'agent', text: `line ${i} we will schedule that for you now` }));
    const idx: number[] = lib.pickSnippet(long);
    expect(idx.length).toBeLessThanOrEqual(6);
    expect(idx.every((i) => i >= 0 && i < long.length)).toBe(true);
  });
});

describe('row + args', () => {
  it('buildSampleRow matches the migration shape and is never published', () => {
    const sc = doc.scenarios[0];
    const row = lib.buildSampleRow({ scenario: sc, transcript: [{ speaker: 'agent', text: 'a' }], audioPath: 'freight/1.mp3', durationSec: 71.6 });
    expect(Object.keys(row).sort()).toEqual(['audio_duration_sec', 'audio_path', 'business_name', 'disclosure', 'product', 'published', 'snippet', 'title', 'transcript']);
    expect(row.published).toBe(false);
    expect(row.audio_duration_sec).toBe(72);
    expect(row.product).toBe('calldesk:freight');
  });
  it('parseArgs validates', () => {
    expect(lib.parseArgs(['--vertical', 'freight', '--dry-run'])).toMatchObject({ vertical: 'freight', dryRun: true, upload: false, publish: null });
    expect(() => lib.parseArgs(['--vertical', 'nope'])).toThrow();
    expect(() => lib.parseArgs([])).toThrow();
    expect(() => lib.parseArgs(['--publish', 'abc'])).toThrow();
    expect(() => lib.parseArgs(['--publish', '11111111-1111-1111-1111-111111111111', '--upload'])).toThrow();
    expect(lib.parseArgs(['--publish', '11111111-1111-1111-1111-111111111111']).publish).toBeTruthy();
  });
  it('estimateCostUsd and isE164', () => {
    expect(lib.estimateCostUsd(60)).toBeCloseTo(0.116, 3);
    expect(lib.isE164('+15551234567')).toBe(true);
    expect(lib.isE164('5551234567')).toBe(false);
  });
});

describe('spoken disclosure in greeting', () => {
  it('every shipped greeting discloses an AI demo / fictional business', () => {
    for (const s of doc.scenarios) expect(s.greeting).toMatch(/\bAI\b/);
  });
  it('validator fails when the greeting lacks the wording', () => {
    const bad = structuredClone(doc);
    bad.scenarios[3].greeting = 'Cedar Line Insurance Agency, how can I help?';
    const errs: string[] = lib.validateScenarios(bad);
    expect(errs.some((e) => /cedar|insurance/i.test(e) || /greeting must state spoken disclosure/.test(e))).toBe(true);
    bad.scenarios[3].greeting = 'Hi, this is an AI helper.'; // AI but no demo/fictional
    expect(lib.validateScenarios(bad).some((e: string) => /spoken disclosure/.test(e))).toBe(true);
  });
});

describe('call gating', () => {
  const ok = { placeCall: true, used: 0, callee: '+15550001111', allowedRaw: '+15550001111, +15550002222' };
  it('allows an explicit, allow-listed call under the cap', () => {
    expect(lib.checkCallGate(ok)).toEqual({ ok: true, reasons: [] });
  });
  it('requires --place-call', () => {
    expect(lib.checkCallGate({ ...ok, placeCall: false }).ok).toBe(false);
    expect(lib.parseArgs(['--vertical', 'freight']).placeCall).toBe(false);
    expect(lib.parseArgs(['--vertical', 'freight', '--place-call']).placeCall).toBe(true);
  });
  it('refuses at the cap of 2 and treats a garbage counter as used up', () => {
    expect(lib.MAX_REAL_CALLS).toBe(2);
    expect(lib.checkCallGate({ ...ok, used: 1 }).ok).toBe(true);
    expect(lib.checkCallGate({ ...ok, used: 2 }).ok).toBe(false);
    expect(lib.parseCounter(null)).toBe(0);
    expect(lib.parseCounter('1\n')).toBe(1);
    expect(lib.parseCounter('oops')).toBe(2);
    expect(lib.parseCounter('-1')).toBe(2);
  });
  it('refuses a callee not in SAMPLE_CALLEE_ALLOWED (or an empty list)', () => {
    expect(lib.checkCallGate({ ...ok, callee: '+15559999999' }).ok).toBe(false);
    expect(lib.checkCallGate({ ...ok, allowedRaw: '' }).ok).toBe(false);
    expect(lib.checkCallGate({ ...ok, callee: undefined }).ok).toBe(false);
  });
});

describe('publish validation', () => {
  const good = { audio_path: 'freight/1.mp3', transcript: [1, 2, 3, 4].map((n) => ({ speaker: 'agent', text: `l${n}` })), snippet: [0, 1, 2, 3] };
  it('accepts a complete sample', () => expect(lib.validatePublishable(good)).toEqual([]));
  it('rejects missing audio, short transcript, empty/out-of-range snippet, missing row', () => {
    expect(lib.validatePublishable({ ...good, audio_path: null }).length).toBe(1);
    expect(lib.validatePublishable({ ...good, transcript: good.transcript.slice(0, 3) }).length).toBeGreaterThan(0);
    expect(lib.validatePublishable({ ...good, snippet: [] })).toContain('snippet is empty');
    expect(lib.validatePublishable({ ...good, snippet: null }).length).toBe(1);
    expect(lib.validatePublishable({ ...good, snippet: [0, 9] }).length).toBe(1);
    expect(lib.validatePublishable(null)).toEqual(['sample not found']);
  });
});

describe('dry run makes no network calls', () => {
  const env = {
    get: (k: string) => ({ CALL_LOOP_POC_BASE_URL: 'https://poc.example', CALL_LOOP_POC_TEST_CALL_SECRET: 's', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', SAMPLE_CALLEE_ALLOWED: '+15550001111' } as Record<string, string>)[k] || '',
    path: '', exists: false,
  };
  const sc = doc.scenarios[0];
  for (const [name, args] of [
    ['--dry-run', { dryRun: true, placeCall: true, calleeNumber: '+15550001111' }],
    ['bare --vertical (no --place-call)', { dryRun: false, placeCall: false, calleeNumber: '+15550001111' }],
  ] as const) {
    it(`${name} never calls fetch`, async () => {
      const f = vi.fn();
      vi.stubGlobal('fetch', f);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await generate(args, env, sc, '/tmp/never-written', join(mkdtempSync(join(tmpdir(), 'sample-counter-')), '.sample-calls-used'));
      expect(f).not.toHaveBeenCalled();
      expect(log.mock.calls.flat().join('\n')).toContain('+15550001111'); // full number shown, not masked
      log.mockRestore();
      vi.unstubAllGlobals();
    });
  }
});
