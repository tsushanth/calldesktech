'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveDemo, type LiveDemoConfig } from '@/lib/useLiveDemo';

type Loaded = { label: string; maxSeconds: number; flow: unknown; context: Record<string, unknown> };

const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-lg px-5 py-12 text-[#00122e]">{children}</main>;
}

export default function TalkClient({ slug }: { slug: string }) {
  const [cfg, setCfg] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/demo-links/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as Loaded) : Promise.reject(r.status)))
      .then((c) => live && setCfg(c))
      .catch((s) => live && setProblem(s === 429 ? 'Too many requests. Please try again in a few minutes.' : 'This demo link is not available. It may have expired.'));
    return () => { live = false; };
  }, [slug]);

  if (problem) return <Shell><h1 className="text-2xl font-semibold">Demo unavailable</h1><p className="mt-3 text-gray-600">{problem}</p></Shell>;
  if (!cfg) return <Shell><p className="text-gray-500">Loading the demo...</p></Shell>;
  return <Call cfg={cfg} />;
}

function Call({ cfg }: { cfg: Loaded }) {
  const config = useMemo<LiveDemoConfig>(() => ({ flow: cfg.flow, context: cfg.context, maxSeconds: cfg.maxSeconds, eventPrefix: 'demo_link' }), [cfg]);
  const live = useLiveDemo(config);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [live.messages.length]);

  const active = live.status === 'live' || live.status === 'connecting';
  return (
    <Shell>
      <p className="text-[13px] font-medium uppercase tracking-wide text-[#00122e]/50">Live demo</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{cfg.label}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
        You are talking to an AI assistant. Press start and allow your microphone to speak with it, or type if you prefer. Interrupt it, change your mind, ask it anything a caller would.
      </p>

      {!active && (
        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={() => live.start({ mic: true })} className="rounded-md bg-[#00122e] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[#0a2450]">
            {live.status === 'ended' ? 'Start again' : 'Start the call'}
          </button>
          <button onClick={() => live.start({ mic: false })} className="rounded-md border border-gray-300 px-5 py-2.5 text-[14px] font-medium hover:bg-gray-50">Type instead</button>
        </div>
      )}

      {live.error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[14px] text-red-700" role="alert">{live.error}</p>}

      {(active || live.messages.length > 0) && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4" aria-label="Conversation">
          <div className="flex items-center justify-between text-[13px] text-gray-500">
            <span>{live.status === 'connecting' ? 'Connecting...' : live.status === 'live' ? (live.agentSpeaking ? 'Speaking...' : live.micState === 'on' ? 'Listening...' : 'Connected') : 'Call ended'}</span>
            {active && <span>{clock(live.secondsLeft)} left</span>}
          </div>
          <div className="mt-3 max-h-[46vh] space-y-3 overflow-y-auto">
            {live.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'agent' ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.4] ${m.role === 'agent' ? 'rounded-tr-md bg-[#eaf0ff]' : 'rounded-tl-md bg-[#f1f2f6]'}`}>{m.text}</p>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {active && (
            <>
              <form onSubmit={(e) => { e.preventDefault(); live.sendText(text); setText(''); }} className="mt-3 flex gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-[15px]" />
                <button className="rounded-md border border-gray-300 px-4 py-2 text-[14px] font-medium hover:bg-gray-50">Send</button>
              </form>
              <div className="mt-3 flex gap-3">
                <button onClick={live.toggleMic} className="rounded-md border border-gray-300 px-4 py-2 text-[14px] font-medium hover:bg-gray-50">
                  {live.micState === 'on' ? 'Mute microphone' : live.micState === 'blocked' ? 'Microphone blocked' : 'Turn on microphone'}
                </button>
                <button onClick={live.end} className="rounded-md bg-red-600 px-4 py-2 text-[14px] font-medium text-white hover:bg-red-700">End call</button>
              </div>
            </>
          )}
        </section>
      )}
    </Shell>
  );
}
