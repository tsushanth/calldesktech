// The speech-to-text price is billed by the second with a 10 second minimum per request (live 2026-10-06). Any outreach
// text that quotes the $0.11 per hour price has to say so. Pure helper, used to patch drafts written before that wording.
const NOTE = '(billed by the second, 10 second minimum per request)';

/** Returns the text with the STT minimum added after the first "$0.11 per hour [of audio]"; null when nothing to change. */
export function addSttMinimum(text: string): string | null {
  if (/10[ -]second minimum/i.test(text)) return null;
  const re = /\$0\.11 (?:per|an|a) hour(?: of audio)?(?: of (?:transcribed )?(?:speech|audio))?/i;
  const m = re.exec(text);
  if (!m) return null;
  const end = m.index + m[0].length;
  return `${text.slice(0, end)} ${NOTE}${text.slice(end)}`;
}

/** Removes "realtime" from phrases that claim our speech API is realtime ("a realtime speech-to-text ... API"); null when nothing to change. */
export function dropRealtimeClaim(text: string): string | null {
  const next = text.replace(/\b[Rr]ealtime (?=(?:speech|STT|text-to-speech|TTS))/g, '');
  return next === text ? null : next;
}
