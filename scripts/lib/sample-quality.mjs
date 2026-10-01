// Pure take-quality checks for the vertical sample calls (unit-tested in test/lib/sampleQuality.test.ts).
// A sample call is a real, paid, non-deterministic phone call: some takes are simply bad. These checks turn the
// problems seen in the first pilot takes into an explicit verdict, so a bad take is flagged (and not uploaded for
// review) instead of being found by listening to it.

const DEFAULT_CAP_SEC = 210; // keep in step with call-loop-poc SAMPLE_CALL_TIME_LIMIT_SEC
const MIN_LINES = 8;
// An effect fired in the last few seconds is cut off with the call (or queued behind speech and never heard).
const EFFECT_TAIL_MARGIN_MS = 6000;

// The caller AI refusing/stepping out of its role (it is told "you are not an AI" yet hears an AI-demo greeting).
const CHARACTER_BREAK = [
  /stay in character/i,
  /(can't|cannot|can not|won't|unable to)\s+(participate|play along|pretend|continue)/i,
  /i need to let you know/i,
  /as an ai\b/i,
  /i('m| am) (actually )?an ai\b/i,
  /set this up, but/i,
];

/**
 * @param {{transcript: Array<{speaker:string,text:string}>, durationSec:number, capSec?:number,
 *   expectJingle:boolean, expectEffects:string[], audioEvents?: Array<{kind:string,name:string,atMs:number}>}} t
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function detectBadTake(t) {
  const reasons = [];
  const transcript = t.transcript || [];
  const cap = t.capSec ?? DEFAULT_CAP_SEC;

  for (const l of transcript) {
    if (l.speaker === 'caller' && CHARACTER_BREAK.some((re) => re.test(l.text || ''))) {
      reasons.push(`the caller AI broke character: "${String(l.text).trim().slice(0, 90)}"`);
      break;
    }
  }
  if (transcript.length < MIN_LINES) reasons.push(`transcript is too short (${transcript.length} lines)`);
  if (t.durationSec >= cap - 3) reasons.push(`the call ran into the ${cap}s time cap, so it was cut off mid-conversation`);

  const needsAudio = t.expectJingle || (t.expectEffects || []).length > 0;
  if (needsAudio) {
    if (!Array.isArray(t.audioEvents)) {
      reasons.push('no audio events were reported by the server (an older call-loop?), so the jingle/effects cannot be verified');
    } else {
      if (t.expectJingle && !t.audioEvents.some((e) => e.kind === 'jingle')) reasons.push('the intro jingle never played');
      for (const name of t.expectEffects || []) {
        const ev = t.audioEvents.filter((e) => e.kind === 'effect' && e.name === name);
        if (ev.length === 0) { reasons.push(`the sound effect ${name} never played`); continue; }
        const lastMs = Math.max(...ev.map((e) => e.atMs));
        if (lastMs > t.durationSec * 1000 - EFFECT_TAIL_MARGIN_MS) {
          reasons.push(`the sound effect ${name} fired too close to the end of the call (${Math.max(0, (t.durationSec * 1000 - lastMs) / 1000).toFixed(1)}s before it ended) to be heard`);
        }
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** Why --upload should refuse this take, or null if it may proceed. A take with no quality file is allowed. */
export function uploadBlockedReason(quality, { force } = {}) {
  if (!quality || quality.ok !== false || force) return null;
  return `this take was flagged as bad: ${(quality.reasons || []).join('; ')}. Re-run the call, or pass --force-upload to upload it anyway.`;
}
