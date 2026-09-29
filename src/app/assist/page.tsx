'use client';

// Internal tool, v0: real-time call-assist prototype.
//
// Transcribes the browser's own mic live using the Web Speech API (built
// into Chrome, no vendor integration needed for this prototype — see the
// note in /api/assist/suggest for why Deepgram isn't wired up yet) and asks
// the backend for one short coaching suggestion every time a new chunk of
// speech finalizes.
//
// Mic-only: on a video call (Meet/Zoom) with a headset, this picks up both
// sides well enough to prototype with, because the other party's audio
// plays through the speaker/headset and bleeds into the mic pickup. It does
// NOT capture a real two-line phone call — that needs Twilio Media Streams
// on both legs, which is separate, larger work.
//
// Nothing here is recorded or persisted: transcript lives only in this
// tab's memory and is discarded on refresh.

import { useCallback, useRef, useState } from 'react';

export default function CallAssistPage() {
  const [secret, setSecret] = useState('');
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [suggestion, setSuggestion] = useState('(listening)');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef('');
  const pendingRef = useRef(false);

  const askForSuggestion = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    try {
      const res = await fetch('/api/assist/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ transcript: transcriptRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'request failed');
      setSuggestion(data.suggestion);
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
      if (finalChunk.trim()) {
        transcriptRef.current = (transcriptRef.current + ' ' + finalChunk).slice(-4000);
        setTranscript(transcriptRef.current);
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
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Call assist (v0 prototype)</h1>
      <p style={{ color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: 10, fontSize: 14 }}>
        Reminder: say &ldquo;this call may be monitored/recorded for quality&rdquo; (or equivalent)
        before the substantive part of any real call this is used on. That disclosure is required
        regardless of whether anything is actually saved &mdash; nothing here is, but the legal
        trigger is processing the call&rsquo;s content, not storage.
      </p>

      {!secret && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>Access code</label>
          <input
            type="password"
            onChange={(e) => setSecret(e.target.value)}
            style={{ padding: 8, width: '100%', boxSizing: 'border-box' }}
            placeholder="paste the shared code"
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={listening ? stop : start}
          disabled={!secret}
          style={{
            padding: '8px 16px',
            background: listening ? '#dc2626' : '#16a34a',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: secret ? 'pointer' : 'not-allowed',
          }}
        >
          {listening ? 'Stop' : 'Start listening'}
        </button>
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 14 }}>{error}</p>}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>SUGGESTED NEXT LINE</div>
        <div style={{ fontSize: 22, fontWeight: 600, padding: 16, background: '#f0fdf4', borderRadius: 8, minHeight: 32 }}>
          {suggestion}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>LIVE TRANSCRIPT (this tab only, not saved)</div>
        <div style={{ fontSize: 14, color: '#374151', padding: 12, background: '#f9fafb', borderRadius: 8, minHeight: 120, whiteSpace: 'pre-wrap' }}>
          {transcript || 'Nothing yet — press start and speak.'}
        </div>
      </div>
    </div>
  );
}
