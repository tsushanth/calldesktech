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
 *   recordingSec?:number, endsMidSpeech?:boolean, expectJingle:boolean, expectEffects:string[], audioEvents?: Array<{kind:string,name:string,atMs:number}>}} t
 * @returns {{ok:boolean, reasons:string[]}}
 */
const GOODBYE = /\b(good ?bye|bye|take care|have a (good|great|nice|wonderful) (day|one|evening))\b/i;
const REGREET = /\b(how (can|may) i help|can i help you|what can i do for you)\b/i;

export function detectBadTake(t) {
  const reasons = [];
  const transcript = t.transcript || [];
  const cap = t.capSec ?? DEFAULT_CAP_SEC;
  // What the listener actually gets is the RECORDING, which can be much shorter than the call (final dental pass: call
  // 181s, recording 145s). Judge "is the effect audible" against the recording; fall back to the call length if unknown.
  const audibleSec = t.recordingSec ?? t.durationSec;

  for (const l of transcript) {
    if (l.speaker === 'caller' && CHARACTER_BREAK.some((re) => re.test(l.text || ''))) {
      reasons.push(`the caller AI broke character: "${String(l.text).trim().slice(0, 90)}"`);
      break;
    }
  }
  // Defects seen in the first v4 Turbo batch that the other checks cannot see (all spoken aloud in the recording):
  for (const l of transcript) {
    const txt = String(l.text || '');
    if (l.speaker === 'agent' && /\btool name\b|play_sound_effect|function call/i.test(txt)) { reasons.push(`the agent spoke tool/system text aloud: "${txt.trim().slice(0, 60)}"`); break; }
  }
  for (const l of transcript) {
    const txt = String(l.text || '');
    if (/\*[^*\n]{2,30}\*/.test(txt)) { reasons.push(`a stage direction was spoken or written into the call: "${txt.trim().slice(0, 60)}"`); break; }
  }
  for (const l of transcript) {
    if (l.speaker !== 'agent') continue;
    const runs = String(l.text || '').match(/(?:\b\d\b[ ,.-]*){4,}/g) || [];
    if (runs.some((r) => (r.match(/\d/g) || []).length === 7)) { reasons.push('the agent read back a 7-digit number (the area code was dropped)'); break; }
  }
  // A goodbye loop: the closing exchange is mis-heard ("Bye!" -> "Hi.") and the agent greets again, so the sample keeps going
  // after its natural ending. Seen on the first v4 Turbo take; the cut-off check does not catch it.
  const byeAt = transcript.findIndex((l, i) => i >= 3 && l.speaker === 'agent' && GOODBYE.test(l.text || ''));
  if (byeAt >= 0) {
    const again = transcript.slice(byeAt + 1).find((l) => l.speaker === 'agent' && REGREET.test(l.text || ''));
    if (again) reasons.push(`the agent greets again after saying goodbye ("${String(again.text).trim().slice(0, 60)}"): the call looped past its ending`);
  }
  if (transcript.length < MIN_LINES) reasons.push(`transcript is too short (${transcript.length} lines)`);
  if (t.durationSec >= cap - 3) reasons.push(`the call ran into the ${cap}s time cap, so it was cut off mid-conversation`);
  if (t.endsMidSpeech === true) reasons.push('the recording ends while the agent is still speaking (a cut-off ending)');

  const needsAudio = t.expectJingle || (t.expectEffects || []).length > 0;
  if (needsAudio) {
    if (!Array.isArray(t.audioEvents)) {
      reasons.push('no audio events were reported by the server (an older call-loop?), so the jingle/effects cannot be verified');
    } else {
      if (t.expectJingle && !t.audioEvents.some((e) => e.kind === 'jingle')) reasons.push('the intro jingle never played');
      for (const name of t.expectEffects || []) {
        const ev = t.audioEvents.filter((e) => e.kind === 'effect' && e.name === name);
        if (ev.length === 0) { reasons.push(`the sound effect ${name} never played`); continue; }
        // A sample demonstrates ONE moment: more than one play is a bad take. The tail rule is judged on the FIRST play,
        // which is the moment the scenario is about.
        if (ev.length > 1) reasons.push(`the sound effect ${name} played ${ev.length} times (expected once)`);
        const firstMs = Math.min(...ev.map((e) => e.atMs));
        if (firstMs > audibleSec * 1000 - EFFECT_TAIL_MARGIN_MS) {
          reasons.push(`the sound effect ${name} fired too close to the end of the recording (${Math.max(0, (audibleSec * 1000 - firstMs) / 1000).toFixed(1)}s before it ended) to be heard`);
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

// Is the agent still talking in the last half second? `pcm` is the agent channel (Int16). Speech-level energy there
// means the recording stopped mid-sentence; silence means a natural ending. Empty/near-silent input is "no".
const TAIL_SECONDS = 0.5;
const TAIL_SPEECH_RMS = 500; // agent speech on this line is ~2000-3000; a noise floor is far below this
export function tailIsSpeech(pcm, sampleRate) {
  const n = Math.floor(sampleRate * TAIL_SECONDS);
  if (!pcm || pcm.length < n || n === 0) return false;
  let sum = 0;
  for (let i = pcm.length - n; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / n) > TAIL_SPEECH_RMS;
}
