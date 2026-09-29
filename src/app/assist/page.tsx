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
//
// Dark theme with every color set explicitly (background, text, borders) —
// the first version left several elements with no explicit color and let
// the browser's dark-mode UA defaults render near-invisible pale-on-pale
// text; this version never relies on an inherited/default color anywhere.

import { useCallback, useRef, useState } from 'react';

const colors = {
  bg: '#0b0d10',
  panel: '#15181d',
  panelBorder: '#262b33',
  text: '#e6e8eb',
  textDim: '#8b93a1',
  accent: '#22c55e',
  accentText: '#eafff1',
  accentPanel: '#0f2417',
  accentBorder: '#1f7a44',
  warnPanel: '#2a2210',
  warnBorder: '#5c4a12',
  warnText: '#f2c94c',
  danger: '#ef4444',
};

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
    <div style={{ minHeight: '100vh', background: colors.bg, color: colors.text }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0 }}>Call assist</h1>
          <span style={{ fontSize: 12, color: colors.textDim, border: `1px solid ${colors.panelBorder}`, borderRadius: 999, padding: '3px 10px' }}>
            v0 prototype
          </span>
        </div>

        <p style={{ color: colors.warnText, background: colors.warnPanel, border: `1px solid ${colors.warnBorder}`, borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 }}>
          Reminder: say &ldquo;this call may be monitored/recorded for quality&rdquo; (or equivalent)
          before the substantive part of any real call this is used on. That disclosure is required
          regardless of whether anything is actually saved &mdash; nothing here is, but the legal
          trigger is processing the call&rsquo;s content, not storage.
        </p>

        {!secret && (
          <div style={{ margin: '20px 0' }}>
            <label style={{ display: 'block', fontSize: 13, color: colors.textDim, marginBottom: 6 }}>Access code</label>
            <input
              type="password"
              onChange={(e) => setSecret(e.target.value)}
              style={{
                padding: 10,
                width: '100%',
                boxSizing: 'border-box',
                background: colors.panel,
                border: `1px solid ${colors.panelBorder}`,
                borderRadius: 8,
                color: colors.text,
                fontSize: 14,
              }}
              placeholder="paste the shared code"
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, margin: '20px 0' }}>
          <button
            onClick={listening ? stop : start}
            disabled={!secret}
            style={{
              padding: '10px 20px',
              background: listening ? colors.danger : colors.accent,
              color: '#08130c',
              fontWeight: 600,
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              cursor: secret ? 'pointer' : 'not-allowed',
              opacity: secret ? 1 : 0.5,
            }}
          >
            {listening ? '● Stop listening' : 'Start listening'}
          </button>
          {listening && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colors.textDim }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.accent, display: 'inline-block' }} />
              live
            </span>
          )}
        </div>

        {error && (
          <p style={{ color: colors.danger, fontSize: 13, background: '#2a1414', border: '1px solid #5c1f1f', borderRadius: 8, padding: 10 }}>
            {error}
          </p>
        )}

        <div style={{ margin: '24px 0' }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.5, color: colors.textDim, marginBottom: 8 }}>
            SUGGESTED NEXT LINE
          </div>
          <div
            style={{
              fontSize: 24,
              lineHeight: 1.4,
              fontWeight: 600,
              padding: 20,
              background: colors.accentPanel,
              border: `1px solid ${colors.accentBorder}`,
              borderRadius: 12,
              minHeight: 40,
              color: colors.accentText,
            }}
          >
            {suggestion}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.5, color: colors.textDim, marginBottom: 8 }}>
            LIVE TRANSCRIPT (this tab only, not saved)
          </div>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: colors.text,
              padding: 16,
              background: colors.panel,
              border: `1px solid ${colors.panelBorder}`,
              borderRadius: 12,
              minHeight: 140,
              whiteSpace: 'pre-wrap',
            }}
          >
            {transcript || <span style={{ color: colors.textDim }}>Nothing yet — press start and speak.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
