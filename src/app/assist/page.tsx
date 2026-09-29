'use client';

// Internal tool, v0: real-time call-assist prototype.
//
// Streams the browser's mic audio to a small relay service
// (calldesk-assist-relay, a separate tiny process — see its repo for why)
// which forwards it to Deepgram's live API with diarization on and relays
// the diarized transcript back. This replaced an earlier Web Speech API +
// content-guessed-speaker version: Web Speech API struggled to even
// finalize speech reliably with two blended voices in one mic, and guessing
// "you" vs "customer" from words alone mislabeled an unambiguous agent
// greeting on the very first real test. Deepgram's diarization separates
// speakers by actual voice characteristics, the same technique already
// proven in the MeetingMind app (Deepgram nova-2, diarize=true) — just
// applied live instead of to a finished recording.
//
// Speaker labels: Deepgram gives numeric speaker indices (0, 1, ...), not
// roles. The first index heard is labeled "You" and any other index
// "Customer" — a real, deterministic mapping (not a guess) that holds for
// how these calls actually go: the agent speaks first.
//
// Mic-only: on a video call (Meet/Zoom) with a headset, this picks up both
// sides because the other party's audio plays through the speaker/headset
// and bleeds into the mic pickup. It does NOT capture a real two-line phone
// call — that needs Twilio Media Streams on both legs, which is separate,
// larger work, and unnecessary if this mic-only path proves reliable enough.
//
// Nothing here is recorded or persisted: audio goes browser -> relay ->
// Deepgram and back as a live pass-through; transcript lives only in this
// tab's memory and is discarded on refresh.
//
// Visual theme matches src/app/samples/[product]/page.tsx (the shipped
// Calldesk sample-call page) on purpose: same light shell, same card
// treatment, same amber disclosure — this is an internal tool for the same
// product, not a place to invent a new look.

import { useCallback, useEffect, useRef, useState } from 'react';

interface Turn {
  id: number;
  speaker: 'you' | 'customer';
  text: string;
}

type Stage = 'opening' | 'discovery' | 'objection' | 'close' | 'wrap-up';

const DEFAULT_GOAL =
  'Get the business owner to agree to forward their overflow/after-hours calls to a number we give them, for a free 2-week trial.';

const RELAY_URL = process.env.NEXT_PUBLIC_ASSIST_RELAY_URL || 'wss://calldesk-assist-relay.fly.dev/';

const STAGE_LABEL: Record<Stage, string> = {
  opening: 'Opening',
  discovery: 'Discovery',
  objection: 'Handling objection',
  close: 'Closing',
  'wrap-up': 'Wrap-up',
};

const STAGE_COLOR: Record<Stage, string> = {
  opening: 'bg-gray-100 text-gray-600',
  discovery: 'bg-blue-50 text-blue-700',
  objection: 'bg-amber-50 text-amber-800',
  close: 'bg-green-50 text-green-700',
  'wrap-up': 'bg-gray-100 text-gray-600',
};

// fetch() Authorization headers must be ISO-8859-1 — a pasted access code
// can carry an invisible character outside that range (a non-breaking
// space from a copy, a smart quote from autocorrect, a stray newline) that
// throws "non ISO-8859-1 code point" deep inside fetch() itself with no
// useful message. Stripping to the printable ASCII range on input means a
// messy paste still works instead of failing with a cryptic browser error.
function sanitizeSecret(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '').trim();
}

export default function CallAssistPage() {
  const [secret, setSecret] = useState('');
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [listening, setListening] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [line, setLine] = useState('Press start and speak — a suggestion will appear here.');
  const [cue, setCue] = useState('');
  const [stage, setStage] = useState<Stage>('opening');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speakerMapRef = useRef<Map<number, 'you' | 'customer'>>(new Map());
  const transcriptRef = useRef(''); // "You: ... \nCustomer: ..." rolling log sent to /api/assist/suggest
  const goalRef = useRef(goal);
  const nextIdRef = useRef(0);
  const pendingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    goalRef.current = goal;
  }, [goal]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const askForSuggestion = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    try {
      const res = await fetch('/api/assist/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ transcript: transcriptRef.current, goal: goalRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'request failed');
      setLine(data.line);
      setCue(data.cue);
      if (data.stage) setStage(data.stage);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'suggestion failed');
    } finally {
      pendingRef.current = false;
    }
  }, [secret]);

  const labelFor = useCallback((speakerIndex: number): 'you' | 'customer' => {
    const map = speakerMapRef.current;
    if (!map.has(speakerIndex)) {
      // First index ever heard in this session is "you" (the agent speaks
      // first on these calls); every other index is "customer".
      map.set(speakerIndex, map.size === 0 ? 'you' : 'customer');
    }
    return map.get(speakerIndex)!;
  }, []);

  const stop = useCallback(() => {
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    speakerMapRef.current = new Map();
    transcriptRef.current = '';

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Mic access was blocked or unavailable — allow microphone access and try again.');
      return;
    }
    streamRef.current = stream;

    const ws = new WebSocket(`${RELAY_URL}?secret=${encodeURIComponent(secret)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setListening(true);
    };

    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      const alt = msg?.channel?.alternatives?.[0];
      const words: any[] = alt?.words || [];
      if (!msg?.is_final || words.length === 0) return;

      // Group consecutive words by speaker into one line per turn.
      let current: { speaker: number; text: string[] } | null = null;
      const lines: { speaker: number; text: string }[] = [];
      for (const w of words) {
        const spk = typeof w.speaker === 'number' ? w.speaker : 0;
        if (!current || current.speaker !== spk) {
          if (current) lines.push({ speaker: current.speaker, text: current.text.join(' ') });
          current = { speaker: spk, text: [w.punctuated_word || w.word] };
        } else {
          current.text.push(w.punctuated_word || w.word);
        }
      }
      if (current) lines.push({ speaker: current.speaker, text: current.text.join(' ') });

      for (const l of lines) {
        const speaker = labelFor(l.speaker);
        transcriptRef.current = (transcriptRef.current + `\n${speaker === 'you' ? 'You' : 'Customer'}: ${l.text}`).slice(-4000);
        setTurns((prev) => [...prev, { id: nextIdRef.current++, speaker, text: l.text }]);
      }
      askForSuggestion();
    };

    ws.onerror = () => setError('Lost connection to the assist relay.');
    ws.onclose = (event) => {
      if (event.code === 4001) setError('Access code was rejected by the relay.');
      if (recorderRef.current) stop();
    };
  }, [secret, labelFor, askForSuggestion, stop]);

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-gray-400">Calldesk</p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">Call assist</h1>

        <div role="note" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] leading-relaxed text-amber-900">
          Say &ldquo;this call may be monitored for quality&rdquo; (or equivalent) before the real
          conversation starts. That&rsquo;s required regardless of whether anything is saved &mdash;
          nothing here is &mdash; the disclosure covers processing the call, not storage.
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <label className="block text-[13px] font-medium text-gray-600" htmlFor="call-goal">
            Call goal
          </label>
          <textarea
            id="call-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            disabled={listening}
            className="mt-2 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-500"
          />
          <p className="mt-1.5 text-[12px] text-gray-400">
            Every suggestion aims at this, not just the last thing said. Edit before you start
            listening — locked while a call is live so the goal doesn&rsquo;t shift mid-call.
          </p>
        </div>

        {!secret ? (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
            <label className="block text-[13px] font-medium text-gray-600" htmlFor="access-code">
              Access code
            </label>
            <input
              id="access-code"
              type="password"
              onChange={(e) => setSecret(sanitizeSecret(e.target.value))}
              placeholder="paste the shared code"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[15px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={listening ? stop : start}
              className={`rounded-lg px-4 py-2 text-[14px] font-semibold text-white transition-colors ${
                listening ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {listening ? 'Stop listening' : 'Start listening'}
            </button>
            {listening && (
              <span className="flex items-center gap-1.5 text-[13px] text-gray-500">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
                Listening
              </span>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
        )}

        <div className="mt-8 flex items-center gap-2">
          <h2 className="text-[15px] font-semibold">Suggested next move</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${STAGE_COLOR[stage]}`}>
            {STAGE_LABEL[stage]}
          </span>
        </div>

        <div className="mt-3 rounded-xl border border-gray-200 border-l-4 border-l-blue-600 bg-white px-4 py-3.5">
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-blue-600">Read it</p>
          <p className="text-[17px] font-medium leading-relaxed">{line}</p>
        </div>

        {cue && cue !== line && (
          <div className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Or bring up, in your own words</p>
            <p className="text-[15px] leading-relaxed text-gray-700">{cue}</p>
          </div>
        )}

        <h2 className="mt-8 text-[15px] font-semibold">Live transcript</h2>
        <p className="mt-1 text-[13px] text-gray-500">
          Stays in this tab only, nothing is saved. Speakers are separated by voice (Deepgram
          diarization), not guessed from what&rsquo;s said.
        </p>
        <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4">
          {turns.length === 0 ? (
            <p className="text-center text-[14px] text-gray-400">Nothing yet — press start and speak.</p>
          ) : (
            turns.map((t) => {
              const you = t.speaker === 'you';
              return (
                <div key={t.id} className={`flex ${you ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                      you ? 'rounded-bl-sm border border-gray-200 bg-white' : 'rounded-br-sm bg-blue-600 text-white'
                    }`}
                  >
                    <p className={`mb-0.5 text-[11px] font-semibold uppercase tracking-wider ${you ? 'text-gray-400' : 'text-blue-100'}`}>
                      {you ? 'You' : 'Customer'}
                    </p>
                    {t.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </main>
  );
}
