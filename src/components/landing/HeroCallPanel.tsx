'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HeroScenario } from '@/lib/heroScenarios';
import type { useLiveDemo } from '@/lib/useLiveDemo';

type Live = ReturnType<typeof useLiveDemo>;

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false
  );
}

function clock(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {!on && <path d="M4 4l16 16" />}
    </svg>
  );
}

function Bubble({ who, text }: { who: 'caller' | 'agent'; text: string }) {
  const agent = who === 'agent';
  return (
    <div className={`flex ${agent ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[86%]">
        <p className={`mb-1 text-[12px] text-[#00122e]/55 ${agent ? 'text-right' : ''}`}>{agent ? 'Calldesk agent' : 'Caller'}</p>
        <p
          className={`rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.4] ${
            agent ? 'rounded-tr-md bg-[#eaf0ff] text-[#00122e]' : 'rounded-tl-md bg-[#f1f2f6] text-[#00122e]'
          }`}
        >
          {text}
        </p>
      </div>
    </div>
  );
}

export function HeroCallPanel({
  scenario,
  paused,
  onFinishedExample,
  live,
}: {
  scenario: HeroScenario;
  paused: boolean;
  onFinishedExample: () => void;
  live: Live;
}) {
  const reduced = usePrefersReducedMotion();
  const isLive = live.status === 'connecting' || live.status === 'live';
  const ended = live.status === 'ended';
  // How many lines of the current example have been revealed, keyed by scenario
  // so switching examples starts from zero without resetting state in an effect.
  const [reveal, setReveal] = useState({ id: scenario.id, n: 0 });
  const shown = reduced ? scenario.lines.length : reveal.id === scenario.id ? reveal.n : 0;
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const callerTurns = live.messages.filter((m) => m.role === 'caller').length;

  // Reveal the example call line by line.
  useEffect(() => {
    if (isLive || ended || reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    scenario.lines.forEach((_, i) =>
      timers.push(setTimeout(() => setReveal({ id: scenario.id, n: i + 1 }), 200 + i * 1700))
    );
    return () => timers.forEach(clearTimeout);
  }, [scenario, isLive, ended, reduced]);

  // Move on to the next example once this one has been read.
  useEffect(() => {
    if (isLive || ended || reduced || paused || shown < scenario.lines.length) return;
    const t = setTimeout(onFinishedExample, 4200);
    return () => clearTimeout(t);
  }, [shown, scenario, isLive, ended, reduced, paused, onFinishedExample]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, live.messages.length, isLive]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!isLive) live.start({ mic: false });
    live.sendText(text);
    setDraft('');
  };

  const micOn = live.micState === 'on';
  const status = (() => {
    if (live.status === 'connecting') return 'Connecting';
    if (live.micState === 'asking') return 'Allow the microphone in your browser';
    if (live.micState === 'blocked') return 'Microphone is blocked. Type below, or allow it in the address bar.';
    if (live.agentSpeaking) return 'Agent is speaking';
    if (micOn) return 'Listening. Go ahead.';
    return 'Type a reply, or turn on the microphone.';
  })();

  return (
    <div className="flex h-[520px] w-full flex-col overflow-hidden rounded-[20px] bg-white text-[#00122e] shadow-[0_24px_80px_-20px_rgba(0,18,46,0.55)] md:h-[560px]">
      <div className="flex items-center justify-between gap-3 border-b border-[#00122e]/10 px-5 py-3.5">
        {isLive ? (
          <>
            <p className="flex items-center gap-2 text-[14px] font-medium">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full bg-[#e5484d] ${reduced ? '' : 'animate-pulse'}`} />
              Live with Calldesk
              <span className="font-normal tabular-nums text-[#00122e]/55">{clock(live.secondsLeft)} left</span>
            </p>
            <button
              type="button"
              onClick={live.end}
              className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[#00122e]/70 hover:bg-[#00122e]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a2a86]"
            >
              End call
            </button>
          </>
        ) : (
          <>
            <p className="text-[14px] font-medium">{ended ? 'Call ended' : scenario.meta}</p>
            {!ended && <p className="rounded-full bg-[#00122e]/[0.06] px-2.5 py-1 text-[12px] text-[#00122e]/65">Example call</p>}
          </>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4"
        aria-live={isLive ? 'polite' : undefined}
        aria-label={isLive ? 'Conversation with the demo agent' : 'Example call transcript'}
        tabIndex={0}
      >
        {isLive || ended ? (
          <>
            {live.messages.length === 0 && (
              <p className="pt-10 text-center text-[14px] text-[#00122e]/55">
                {live.status === 'connecting' ? 'Connecting to the agent…' : 'The agent will greet you in a moment.'}
              </p>
            )}
            {live.messages.map((m) => (
              <Bubble key={m.id} who={m.role} text={m.text} />
            ))}
            {ended && (
              <div className="rounded-xl bg-[#eaf0ff] p-4 text-[14px] leading-[1.45]">
                <p>That is what a caller would get. To hear it as your own business, with your hours and services, set up an agent.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/demo" className="rounded-md bg-[#0a2a86] px-3.5 py-2 text-[14px] font-medium text-white hover:bg-[#0b3fae] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a2a86]">
                    Set up your own agent
                  </Link>
                  <button type="button" onClick={() => live.start({ mic: true })} className="rounded-md px-3.5 py-2 text-[14px] font-medium text-[#0a2a86] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a2a86]">
                    Talk again
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {scenario.lines.slice(0, shown).map((l, i) => (
              <Bubble key={`${scenario.id}-${i}`} who={l.who} text={l.text} />
            ))}
            {shown >= scenario.lines.length && (
              <p className="flex items-center gap-2 rounded-lg bg-[#e3f5ec] px-3 py-2 text-[14px] font-medium text-[#0f7a4f]">
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 10.5l4 4 8-9" /></svg>
                {scenario.outcome}
              </p>
            )}
          </>
        )}
      </div>

      {live.error && (
        <p role="alert" className="border-t border-[#00122e]/10 bg-[#fdeced] px-5 py-2.5 text-[13px] text-[#a3262b]">
          {live.error}
        </p>
      )}

      {isLive && callerTurns >= 2 && (
        <p className="border-t border-[#00122e]/10 px-5 py-2.5 text-[13px] text-[#00122e]/70">
          Want this on your own line?{' '}
          <Link href="/demo" className="font-medium text-[#0a2a86] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a2a86]">
            Set up your agent
          </Link>{' '}
          and explore the full demo.
        </p>
      )}

      <div className="border-t border-[#00122e]/10 px-4 pb-4 pt-3">
        {isLive && <p className="mb-2 px-1 text-[13px] text-[#00122e]/60">{status}</p>}
        <form onSubmit={submit} className="flex items-center gap-2">
          <label htmlFor="hero-demo-input" className="sr-only">
            Message the demo agent
          </label>
          <input
            id="hero-demo-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={isLive ? 'Type a reply' : 'Try it: type what a caller would say'}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border border-[#00122e]/15 bg-white px-3.5 py-3 text-[15px] placeholder:text-[#00122e]/40 focus-visible:border-[#0a2a86] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a2a86]/30"
          />
          <button
            type="button"
            onClick={() => (isLive ? live.toggleMic() : live.start({ mic: true }))}
            aria-pressed={micOn}
            aria-label={micOn ? 'Turn microphone off' : 'Talk with your microphone'}
            className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a2a86] ${
              micOn ? 'border-[#e5484d] bg-[#e5484d] text-white' : 'border-[#00122e]/15 bg-white text-[#00122e] hover:bg-[#00122e]/5'
            }`}
          >
            <MicIcon on={micOn} />
          </button>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-[46px] shrink-0 rounded-xl bg-[#0a2a86] px-4 text-[15px] font-medium text-white hover:bg-[#0b3fae] disabled:cursor-not-allowed disabled:bg-[#0a2a86]/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a2a86]"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
