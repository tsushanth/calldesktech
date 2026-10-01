import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as audio from '../../scripts/lib/sample-audio.mjs';
import * as lib from '../../scripts/lib/sample-lib.mjs';

const doc = JSON.parse(readFileSync('scripts/sample-scenarios.json', 'utf8'));
type Sc = { id: string; agentPrompt: string; audio?: { jingle?: boolean; effects?: Array<{ sound: string; name: string; description: string }> } };
const byId = (id: string) => (doc.scenarios as Sc[]).find((s) => s.id === id)!;
const b64 = (n: number) => Buffer.alloc(n, 7).toString('base64');
const SHARED = { intro_jingle: { audio: b64(32000) }, confirmation_chime: { audio: b64(16000) }, received_chime: { audio: b64(16000) } };

describe('which sample verticals get audio', () => {
  it('sensitive verticals (funeral, bail bonds, home care) and the agency sample get none: a chime would be tone-deaf', () => {
    // agency is optional here: it may not exist on every branch yet (optional chaining keeps this test valid either way)
    for (const id of ['funeral', 'bailbonds', 'homecare', 'agency']) expect(byId(id)?.audio, id).toBeUndefined();
    expect(audio.NO_AUDIO_VERTICALS).toEqual(expect.arrayContaining(['funeral', 'bailbonds', 'homecare', 'agency']));
  });
  it('the other 13 verticals each get the intro jingle and exactly one effect', () => {
    const withAudio = (doc.scenarios as Sc[]).filter((s) => s.audio);
    expect(withAudio.map((s) => s.id).sort()).toEqual(['accounting', 'childcare', 'dental', 'freight', 'homeservices', 'insurance', 'lodging', 'physio', 'realestate', 'septic', 'taxi', 'towing', 'vets']);
    for (const s of withAudio) {
      expect(s.audio!.jingle, s.id).toBe(true);
      expect(s.audio!.effects, s.id).toHaveLength(1);
    }
  });
  it('a "confirmed" chime is only used where the demo agent genuinely confirms; "received" where it only takes a message', () => {
    for (const id of ['dental', 'homeservices', 'septic', 'towing', 'insurance']) expect(byId(id).audio!.effects![0].sound, id).toBe('confirmation_chime');
    // These agents are instructed never to confirm a tour/booking/availability/fare: a confirmation sound would over-claim.
    for (const id of ['freight', 'childcare', 'accounting', 'realestate', 'lodging', 'physio', 'taxi', 'vets']) expect(byId(id).audio!.effects![0].sound, id).toBe('received_chime');
  });
  it('every scenario still validates', () => {
    expect(lib.validateScenarios(doc)).toEqual([]);
    for (const s of doc.scenarios) expect(audio.validateAudioConfig(s), s.id).toEqual([]);
  });
});

describe('validateAudioConfig', () => {
  const ok = () => structuredClone(byId('dental'));
  it('accepts a valid config', () => expect(audio.validateAudioConfig(ok())).toEqual([]));
  it('rejects audio on a no-audio vertical', () => {
    const s = structuredClone(byId('funeral')); s.audio = { jingle: true, effects: [] };
    expect(audio.validateAudioConfig(s).join(' ')).toMatch(/no audio|not allowed/i);
  });
  it('rejects unknown sounds, bad names, empty descriptions, and too many effects', () => {
    const a = ok(); a.audio!.effects![0].sound = 'nope'; expect(audio.validateAudioConfig(a).join(' ')).toMatch(/sound/);
    const b = ok(); b.audio!.effects![0].name = 'has space'; expect(audio.validateAudioConfig(b).join(' ')).toMatch(/name/);
    const c = ok(); c.audio!.effects![0].description = ' '; expect(audio.validateAudioConfig(c).join(' ')).toMatch(/description/);
    const d = ok(); d.audio!.effects = Array.from({ length: 4 }, (_, i) => ({ sound: 'confirmation_chime', name: 'e' + i, description: 'd' })); expect(audio.validateAudioConfig(d).join(' ')).toMatch(/at most/);
  });
  it('rejects the intro jingle used as an effect', () => {
    const a = ok(); a.audio!.effects![0].sound = 'intro_jingle'; expect(audio.validateAudioConfig(a).join(' ')).toMatch(/sound/);
  });
});

describe('buildSampleCallAudio', () => {
  it('builds the inline payload: shared jingle + the scenario\'s effect with its own name/description', () => {
    const out = audio.buildSampleCallAudio(byId('dental'), SHARED);
    expect(out.jingle).toEqual({ name: 'intro', audio: SHARED.intro_jingle.audio });
    expect(out.effects).toEqual([{ name: byId('dental').audio!.effects![0].name, description: byId('dental').audio!.effects![0].description, audio: SHARED.confirmation_chime.audio }]);
  });
  it('returns null for a scenario with no audio configured', () => {
    expect(audio.buildSampleCallAudio(byId('funeral'), SHARED)).toBeNull();
  });
  it('FAILS CLOSED if a needed shared sound has not been generated, instead of producing an audio-less sample', () => {
    expect(() => audio.buildSampleCallAudio(byId('dental'), { intro_jingle: SHARED.intro_jingle })).toThrow(/confirmation_chime/);
    expect(() => audio.buildSampleCallAudio(byId('dental'), { confirmation_chime: SHARED.confirmation_chime })).toThrow(/intro_jingle/);
    expect(() => audio.buildSampleCallAudio(byId('dental'), {})).toThrow();
  });
});

describe('withAudioPromptHint', () => {
  it('appends instructions to call the tool in the SAME turn as the spoken reply, once, without mentioning the sound', () => {
    const out = audio.withAudioPromptHint('Base prompt.', byId('dental').audio);
    expect(out.startsWith('Base prompt.')).toBe(true);
    expect(out).toMatch(/play_sound_effect/);
    expect(out).toMatch(/same turn/i);
    expect(out).toMatch(/never .*earlier|only once|once/i);
    expect(out).toMatch(/do not mention/i);
    expect(out).toMatch(/efficient/i); // keeps the call short enough to reach the moment well inside the time cap
    expect(out).toMatch(/one (short )?question at a time/i);
  });
  it('leaves a prompt without audio untouched', () => {
    expect(audio.withAudioPromptHint('Base prompt.', undefined)).toBe('Base prompt.');
  });
  it('every scenario still fits the poc\'s 6000-char prompt limit with the hint appended', () => {
    for (const s of doc.scenarios as Sc[]) expect(audio.withAudioPromptHint(s.agentPrompt, s.audio).length, s.id).toBeLessThanOrEqual(6000);
  });
});

describe('shared sounds', () => {
  it('defines exactly the three sounds the scenarios use, each within the 1-12s generation limit', () => {
    expect(Object.keys(audio.SHARED_SOUNDS).sort()).toEqual(['confirmation_chime', 'intro_jingle', 'received_chime']);
    for (const [k, v] of Object.entries(audio.SHARED_SOUNDS) as Array<[string, { prompt: string; durationSec: number }]>) {
      expect(v.durationSec, k).toBeGreaterThanOrEqual(1);
      expect(v.durationSec, k).toBeLessThanOrEqual(12);
      expect(v.prompt.length, k).toBeGreaterThan(10);
    }
  });
  it('every sound the scenarios reference is one that exists', () => {
    for (const s of doc.scenarios as Sc[]) for (const e of s.audio?.effects ?? []) expect(Object.keys(audio.SHARED_SOUNDS), s.id).toContain(e.sound);
  });
});

describe('buildPlaceCallRequest', () => {
  const sc = (id: string) => byId(id) as unknown as Record<string, unknown> & Sc & { greeting: string; callerPersona: string; agentVoice: string; callerVoice: string };
  it('adds the inline callAudio and the same-turn hint to the demo agent for a scenario with audio', () => {
    const { body, callAudio } = audio.buildPlaceCallRequest(sc('dental'), { callee: '+15550001111', shared: SHARED });
    expect(callAudio.jingle.name).toBe('intro');
    expect(body.sampleCallee.callAudio).toEqual(callAudio);
    expect(body.sampleCallee.systemPrompt).toContain(byId('dental').agentPrompt);
    expect(body.sampleCallee.systemPrompt).toMatch(/play_sound_effect/);
  });
  it('leaves everything else about the call exactly as before (caller persona, voices, recording, allowlisted callee)', () => {
    const { body } = audio.buildPlaceCallRequest(sc('dental'), { callee: '+15550001111', shared: SHARED });
    const s = sc('dental');
    expect(body).toMatchObject({ toNumber: '+15550001111', shopper: true, record: true, persona: s.callerPersona, shopperVoice: { voice: s.callerVoice, stability: 0.8 } });
    expect(body.sampleCallee).toMatchObject({ greeting: s.greeting, voice: s.agentVoice, stability: 0.8 });
  });
  it('a scenario without audio produces the original request: no callAudio key, prompt untouched', () => {
    const { body, callAudio } = audio.buildPlaceCallRequest(sc('funeral'), { callee: '+15550001111', shared: null });
    expect(callAudio).toBeNull();
    expect('callAudio' in body.sampleCallee).toBe(false);
    expect(body.sampleCallee.systemPrompt).toBe(byId('funeral').agentPrompt);
  });
  it('throws (never dials) for an audio scenario when the shared sounds are missing', () => {
    expect(() => audio.buildPlaceCallRequest(sc('dental'), { callee: '+15550001111', shared: null })).toThrow(/generate-sample-audio/);
  });
});

describe('generate(): refuses to place a real call that would silently lack its audio', () => {
  // Imported lazily: it pulls in node:fs/child_process, fine, but keeps the pure tests above independent.
  const run = async (opts: { fetchImpl: (url: string, init?: RequestInit) => Promise<unknown>; shared: unknown; scenario: string }) => {
    const { generate } = await import('../../scripts/generate-vertical-sample.mjs');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const env = { get: (k: string) => ({ CALL_LOOP_POC_BASE_URL: 'https://poc.example', CALL_LOOP_POC_TEST_CALL_SECRET: 's', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', SAMPLE_CALLEE_NUMBER: '+15550001111', SAMPLE_CALLEE_ALLOWED: '+15550001111' } as Record<string, string>)[k] || '', path: '', exists: false };
    const f = vi.fn(opts.fetchImpl);
    vi.stubGlobal('fetch', f);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);
    const counter = join(mkdtempSync(join(tmpdir(), 'sample-counter-')), '.sample-calls-used');
    let err: unknown = null;
    try { await generate({ dryRun: false, placeCall: true, calleeNumber: '+15550001111' }, env, byId(opts.scenario), '/tmp/never-written', counter, opts.shared); } catch (e) { err = e; }
    return { f, err, counterExists: (await import('node:fs')).existsSync(counter) };
  };
  const json = (b: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => b });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('missing shared sounds: exits before ANY network call', async () => {
    const { f, err } = await run({ scenario: 'dental', shared: null, fetchImpl: async () => json({}) });
    expect(String(err)).toMatch(/process.exit/);
    expect(f).not.toHaveBeenCalled();
  });
  it('a poc without callAudio support: exits at the capability probe, before placing the call', async () => {
    const { f, err, counterExists } = await run({ scenario: 'dental', shared: SHARED, fetchImpl: async (u) => (String(u).endsWith('/sample-callee-capability') ? json({ sampleCallee: 1 }) : json({})) });
    expect(String(err)).toMatch(/process.exit/);
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(['https://poc.example/sample-callee-capability']);
    expect(counterExists).toBe(false); // no call was counted or placed
  });
  it('a poc that places the call but does not confirm callAudio: exits immediately after the dial', async () => {
    const { f, err } = await run({ scenario: 'dental', shared: SHARED, fetchImpl: async (u) => (String(u).endsWith('/sample-callee-capability') ? json({ sampleCallee: 1, callAudio: 1 }) : json({ sid: 'CA' + 'a'.repeat(32), status: 'queued', sampleCallee: true })) });
    expect(String(err)).toMatch(/process.exit/);
    const placed = f.mock.calls.find((c) => String(c[0]).endsWith('/place-test-call'))!;
    expect(JSON.parse((placed[1] as RequestInit).body as string).sampleCallee.callAudio.jingle.name).toBe('intro');
    expect(f.mock.calls.some((c) => String(c[0]).includes('/call-status/'))).toBe(false); // stopped before polling
  });
  it('a scenario with NO audio is unaffected: the probe needs only sampleCallee, as before', async () => {
    const { f } = await run({ scenario: 'funeral', shared: null, fetchImpl: async (u) => (String(u).endsWith('/sample-callee-capability') ? json({ sampleCallee: 1 }) : json({ sid: 'CA' + 'a'.repeat(32), status: 'queued', sampleCallee: false })) }); // unconfirmed => generate() stops right after the dial
    const placed = f.mock.calls.find((c) => String(c[0]).endsWith('/place-test-call'));
    expect(placed).toBeTruthy();
    expect('callAudio' in JSON.parse((placed![1] as RequestInit).body as string).sampleCallee).toBe(false);
  });
});
