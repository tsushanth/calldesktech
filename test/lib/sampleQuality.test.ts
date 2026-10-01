import { describe, it, expect } from 'vitest';
import * as q from '../../scripts/lib/sample-quality.mjs';
import * as lib from '../../scripts/lib/sample-lib.mjs';

const line = (speaker: 'agent' | 'caller', text: string) => ({ speaker, text });
const GOOD = [
  line('agent', 'Maple Court Dental. This is an AI demo call for a fictional business. How can I help?'),
  line('caller', 'Hi, I just moved here and need a cleaning next week.'),
  line('agent', 'Great. I have Tuesday at 10:30.'), line('caller', 'Tuesday works.'),
  line('agent', 'Your name?'), line('caller', 'Michael.'),
  line('agent', 'And your date of birth?'), line('caller', 'March 15th, 1988.'),
  line('agent', 'You are booked for Tuesday at 10:30. Anything else?'), line('caller', 'No, thanks.'),
];
const EVENTS = [{ kind: 'jingle', name: 'intro', atMs: 4 }, { kind: 'effect', name: 'appointment_booked_chime', atMs: 120_000 }];
const base = { transcript: GOOD, durationSec: 160, expectJingle: true, expectEffects: ['appointment_booked_chime'], audioEvents: EVENTS };

describe('detectBadTake', () => {
  it('accepts a normal take where everything configured played with room to spare', () => {
    expect(q.detectBadTake(base)).toEqual({ ok: true, reasons: [] });
  });

  it('flags the caller AI breaking character (seen in 2 of the first 4 pilot takes)', () => {
    for (const said of [
      "I appreciate you setting this up, but I need to stay in character as Michael for this to work properly.",
      "I need to let you know I can't participate in a call where I'm told upfront it's an AI demo.",
      "As an AI, I can't pretend to be a patient.",
    ]) {
      const r = q.detectBadTake({ ...base, transcript: [GOOD[0], line('caller', said), ...GOOD.slice(2)] });
      expect(r.ok, said).toBe(false);
      expect(r.reasons.join(' ')).toMatch(/character/i);
    }
  });
  it('does not flag an AGENT line that happens to mention being an AI (the greeting says so by design)', () => {
    expect(q.detectBadTake(base).ok).toBe(true);
    expect(GOOD[0].text).toMatch(/AI demo/);
  });

  it('flags a transcript too short to be a real call', () => {
    expect(q.detectBadTake({ ...base, transcript: GOOD.slice(0, 4) }).reasons.join(' ')).toMatch(/short/i);
  });

  it('flags a call that ran into the time cap (it was cut off mid-conversation)', () => {
    const r = q.detectBadTake({ ...base, durationSec: 209, capSec: 210 });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/cap|cut/i);
    expect(q.detectBadTake({ ...base, durationSec: 150, capSec: 210 }).ok).toBe(true);
  });

  describe('audio events', () => {
    it('flags a missing jingle when one was configured', () => {
      const r = q.detectBadTake({ ...base, audioEvents: [EVENTS[1]] });
      expect(r.reasons.join(' ')).toMatch(/jingle/i);
    });
    it('does not require a jingle that was not configured', () => {
      expect(q.detectBadTake({ ...base, expectJingle: false, audioEvents: [EVENTS[1]] }).ok).toBe(true);
    });
    it('flags an expected sound effect that never played', () => {
      const r = q.detectBadTake({ ...base, audioEvents: [EVENTS[0]] });
      expect(r.ok).toBe(false);
      expect(r.reasons.join(' ')).toMatch(/appointment_booked_chime.*never/i);
    });
    it('flags an effect that fired too close to the end of the call to be heard in the recording', () => {
      const r = q.detectBadTake({ ...base, durationSec: 160, audioEvents: [EVENTS[0], { kind: 'effect', name: 'appointment_booked_chime', atMs: 158_000 }] });
      expect(r.ok).toBe(false);
      expect(r.reasons.join(' ')).toMatch(/end of the call|too close/i);
    });
    it('reports clearly when the server returned no audio events at all (an older call-loop)', () => {
      const r = q.detectBadTake({ ...base, audioEvents: undefined });
      expect(r.ok).toBe(false);
      expect(r.reasons.join(' ')).toMatch(/no audio events/i);
    });
    it('a scenario with no audio needs no events', () => {
      expect(q.detectBadTake({ ...base, expectJingle: false, expectEffects: [], audioEvents: [] }).ok).toBe(true);
      expect(q.detectBadTake({ ...base, expectJingle: false, expectEffects: [], audioEvents: undefined }).ok).toBe(true);
    });
  });

  it('collects every problem, not just the first', () => {
    const r = q.detectBadTake({ ...base, transcript: GOOD.slice(0, 4), durationSec: 209, capSec: 210, audioEvents: [] });
    expect(r.reasons.length).toBeGreaterThanOrEqual(4);
  });
});

describe('uploadBlockedReason', () => {
  it('blocks uploading a take marked bad, naming why, unless forced', () => {
    const quality = { ok: false, reasons: ['caller broke character'] };
    expect(q.uploadBlockedReason(quality, { force: false })).toMatch(/broke character/);
    expect(q.uploadBlockedReason(quality, { force: true })).toBeNull();
  });
  it('allows a good take, and also an old take that has no quality file at all', () => {
    expect(q.uploadBlockedReason({ ok: true, reasons: [] }, { force: false })).toBeNull();
    expect(q.uploadBlockedReason(null, { force: false })).toBeNull();
  });
});

describe('--force-upload', () => {
  it('is parsed, defaults to off, and only makes sense with --upload', () => {
    expect(lib.parseArgs(['--vertical', 'dental', '--upload']).forceUpload).toBe(false);
    expect(lib.parseArgs(['--vertical', 'dental', '--upload', '--force-upload']).forceUpload).toBe(true);
    expect(() => lib.parseArgs(['--vertical', 'dental', '--force-upload'])).toThrow(/--upload/);
  });
});
