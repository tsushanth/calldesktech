'use client';

import { useRef } from 'react';

export default function SamplePlayer({ src, token }: { src: string; token: string | null }) {
  const sent = useRef({ play: false, complete: false });

  const send = (event: 'play' | 'complete') => {
    if (!token || sent.current[event]) return;
    sent.current[event] = true;
    try {
      void fetch('/api/samples/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, event }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* tracking is best-effort */
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- full transcript is shown below the player
    <audio controls preload="none" src={src} className="w-full" onPlay={() => send('play')} onEnded={() => send('complete')} />
  );
}
