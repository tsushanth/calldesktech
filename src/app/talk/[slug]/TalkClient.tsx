'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Container, Eyebrow } from '@/components/landing/primitives';
import { useLiveDemo, type LiveDemoConfig } from '@/lib/useLiveDemo';

type Loaded = { label: string; maxSeconds: number; flow: unknown; context: Record<string, unknown> };

const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

// The page chrome (header, footer, white page) comes from src/app/talk/layout.tsx, like the other public pages.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <Container className="pb-24 pt-14 md:pt-20">
        <div className="max-w-[720px]">{children}</div>
      </Container>
    </main>
  );
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

  if (problem) return <Shell><h1 className="text-[32px] font-normal tracking-[-0.04em] text-[#00122e]">Demo unavailable</h1><p className="mt-3 text-gray-600">{problem}</p></Shell>;
  if (!cfg) return <Shell><p className="text-gray-500">Loading the demo...</p></Shell>;
  return <Call cfg={cfg} />;
}

// The site's button treatment (landing primitives): 6px radius, navy primary, light-lavender secondary.
const BTN = 'inline-flex items-center justify-center rounded-md px-6 py-3.5 text-[15px] font-medium transition-[opacity,transform,background-color] duration-150 hover:-translate-y-px active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';
const PRIMARY = `${BTN} bg-[#00122e] text-white hover:bg-[#0a2450]`;
const SECONDARY = `${BTN} border border-transparent bg-[#f0f0f8] text-[#00122e] hover:bg-[#e6e6f2]`;

function Call({ cfg }: { cfg: Loaded }) {
  const config = useMemo<LiveDemoConfig>(() => ({ flow: cfg.flow, context: cfg.context, maxSeconds: cfg.maxSeconds, eventPrefix: 'demo_link' }), [cfg]);
  const live = useLiveDemo(config);
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [live.messages.length]);

  const active = live.status === 'live' || live.status === 'connecting';
  const status = live.status === 'connecting' ? 'Connecting...' : live.agentSpeaking ? 'Speaking' : live.micState === 'on' ? 'Listening' : 'Connected';
  const dot = live.status === 'connecting' ? 'bg-[#f59e0b]' : live.agentSpeaking ? 'bg-[#2563eb]' : 'bg-[#16a34a]';

  return (
    <Shell>
      <Eyebrow>Live demo</Eyebrow>
      <h1 className="mt-4 text-[40px] font-normal leading-[1.04] tracking-[-0.05em] text-[#00122e] md:text-[52px]">{cfg.label}</h1>
      <p className="mt-5 max-w-[560px] text-[17px] leading-[1.6] text-gray-600">
        Hear an AI assistant answer a business phone line. Talk to it the way a customer would, and judge how it sounds.
      </p>

      {!active && (
        <>
          <ol className="mt-6 space-y-2.5 text-[15px] text-gray-600">
            <li><span className="mr-2 inline-block h-6 w-6 rounded-full bg-[#eaf0ff] text-center text-[13px] font-semibold leading-6 text-[#1e40af]">1</span>Press <b className="text-[#00122e]">Start the call</b></li>
            <li><span className="mr-2 inline-block h-6 w-6 rounded-full bg-[#eaf0ff] text-center text-[13px] font-semibold leading-6 text-[#1e40af]">2</span>Allow your microphone when asked</li>
            <li><span className="mr-2 inline-block h-6 w-6 rounded-full bg-[#eaf0ff] text-center text-[13px] font-semibold leading-6 text-[#1e40af]">3</span>Speak, interrupt, ask questions. It takes about a minute.</li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => live.start({ mic: true })} className={PRIMARY}>{live.status === 'ended' ? 'Start again' : 'Start the call'}</button>
            <button onClick={() => live.start({ mic: false })} className={SECONDARY}>Type instead</button>
          </div>
        </>
      )}

      {live.error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[14px] text-red-700" role="alert">{live.error}</p>}

      {(active || live.messages.length > 0) && (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5" aria-label="Conversation">
          <div className="flex items-center justify-between text-[13px] text-gray-500">
            {active ? (
              <span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${dot} ${live.status === 'live' ? 'animate-pulse' : ''}`} />{status}</span>
            ) : (
              <span>Call ended</span>
            )}
            {active && <span>{clock(live.secondsLeft)} left</span>}
          </div>
          <div ref={logRef} className="mt-3 max-h-[44vh] space-y-3 overflow-y-auto pr-1">
            {live.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
                <div className="max-w-[88%]">
                  <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide text-[#6b7894] ${m.role === 'agent' ? '' : 'text-right'}`}>{m.role === 'agent' ? 'Assistant' : 'You'}</p>
                  <p className={`rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.45] text-[#00122e] ${m.role === 'agent' ? 'rounded-tl-md bg-[#eaf0ff]' : 'rounded-tr-md bg-[#e9ecf3]'}`}>{m.text}</p>
                </div>
              </div>
            ))}
            {live.messages.length === 0 && <p className="text-[14px] text-[#6b7894]">The assistant will greet you in a moment.</p>}
          </div>
          {active && (
            <>
              <form onSubmit={(e) => { e.preventDefault(); live.sendText(text); setText(''); }} className="mt-4 flex gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type a message" className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-3 py-2.5 text-[15px] text-[#00122e] placeholder:text-gray-400" />
                <button className={`${SECONDARY} !px-4 !py-2.5 !text-[14px]`}>Send</button>
              </form>
              <div className="mt-3 flex gap-3">
                <button onClick={live.toggleMic} className={`${SECONDARY} !py-2.5 !text-[14px]`}>
                  {live.micState === 'on' ? 'Mute microphone' : live.micState === 'blocked' ? 'Microphone blocked' : 'Turn on microphone'}
                </button>
                <button onClick={live.end} className={`${BTN} !py-2.5 !text-[14px] bg-red-600 text-white hover:bg-red-700`}>End call</button>
              </div>
            </>
          )}
        </section>
      )}
    </Shell>
  );
}
