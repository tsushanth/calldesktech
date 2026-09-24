import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as lib from '../../scripts/lib/sample-lib.mjs';

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
