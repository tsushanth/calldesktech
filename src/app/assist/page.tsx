'use client';

// Internal tool, v0: real-time call-assist prototype.
//
// Transcribes the browser's own mic live using the Web Speech API (built
// into Chrome, no vendor integration needed for this prototype — see the
// note in /api/assist/suggest for why Deepgram isn't wired up yet) and asks
// the backend for a goal-anchored suggestion every time a new chunk of
// speech finalizes: a playbook stage, a ready-to-read line, and a shorter
// cue to paraphrase instead — see the note in /api/assist/suggest for why
// both are shown rather than picking one mode.
//
// Mic-only: on a video call (Meet/Zoom) with a headset, this picks up both
// sides well enough to prototype with, because the other party's audio
// plays through the speaker/headset and bleeds into the mic pickup. It does
// NOT capture a real two-line phone call — that needs Twilio Media Streams
// on both legs, which is separate, larger work.
//
// No speaker labels: tried guessing "you" vs "customer" from conversational
// content alone (there's only one mono mic input, no real diarization), and
// it mislabeled an unambiguous agent greeting as the customer on the first
// real test. Rather than show a wrong guess, the transcript is just a plain
// unlabeled log — accurate about what this v0 actually knows.
//
// Nothing here is recorded or persisted: transcript lives only in this
// tab's memory and is discarded on refresh.
//
// Visual theme matches src/app/samples/[product]/page.tsx (the shipped
// Calldesk sample-call page) on purpose: same light shell, same card
// treatment, same amber disclosure — this is an internal tool for the same
// product, not a place to invent a new look.

import { useCallback, useEffect, useRef, useState } from 'react';

interface Turn {
  id: number;
  text: string;
}

type Stage = 'opening' | 'discovery' | 'objection' | 'close' | 'wrap-up';

const DEFAULT_GOAL =
  'Get the business owner to agree to forward their overflow/after-hours calls to a number we give them, for a free 2-week trial.';

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

export default function CallAssistPage() {
  const [secret, setSecret] = useState('');
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [listening, setListening] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [line, setLine] = useState('Press start and speak — a suggestion will appear here.');
  const [cue, setCue] = useState('');
  const [stage, setStage] = useState<Stage>('opening');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef('');
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

  const start = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('This browser doesn’t support live speech recognition — use Chrome.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalChunk += event.results[i][0].transcript + ' ';
      }
      finalChunk = finalChunk.trim();
      if (finalChunk) {
        transcriptRef.current = (transcriptRef.current + ' ' + finalChunk).slice(-4000);
        setTurns((prev) => [...prev, { id: nextIdRef.current++, text: finalChunk }]);
        askForSuggestion();
      }
    };
    recognition.onerror = (event: any) => setError(`mic error: ${event.error}`);
    recognition.onend = () => {
      if (recognitionRef.current) recognition.start(); // auto-restart, browser stops it periodically
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setError(null);
  }, [askForSuggestion]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.stop();
    setListening(false);
  }, []);

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
              onChange={(e) => setSecret(e.target.value)}
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
          Stays in this tab only, nothing is saved. Not speaker-labeled — one mic can&rsquo;t reliably
          tell who&rsquo;s talking, so it isn&rsquo;t guessed.
        </p>
        <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4">
          {turns.length === 0 ? (
            <p className="text-center text-[14px] text-gray-400">Nothing yet — press start and speak.</p>
          ) : (
            turns.map((t) => (
              <p key={t.id} className="text-[15px] leading-relaxed text-[#1a1d29]">
                {t.text}
              </p>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </main>
  );
}
