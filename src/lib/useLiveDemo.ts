'use client';

// Runs a live conversation with the Calldesk intro agent from the landing
// page: the same call-loop-poc WebSocket protocol as the /demo/talk page, but
// usable as text chat first. The socket only opens on a user action (never on
// page load) and the microphone is only requested when the visitor turns it on.
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildIntroFlow, INTRO_MAX_SECONDS } from '@/lib/introFlow';
import { getCallLoopWsUrl } from '@/lib/voiceEngine';
import { track } from '@/components/Analytics';

export type DemoMessage = { id: number; role: 'caller' | 'agent'; text: string };
export type DemoStatus = 'idle' | 'connecting' | 'live' | 'ended';
export type MicState = 'off' | 'asking' | 'on' | 'blocked';

const INTRO_FLOW = buildIntroFlow();
const DAILY_LIMIT_KEY = 'calldesk_hero_demo_uses';
// A soft, per-browser limit. It only deters casual repeat use; real protection
// has to live on the server.
const DAILY_LIMIT = 6;

function downsampleTo16k(input: Float32Array, inputRate: number) {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    // Average the samples each output sample covers, instead of picking one,
    // to keep high frequencies from aliasing into the speech band.
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : input[start] ?? 0;
  }
  return out;
}

function floatToPCM16(float32: Float32Array) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function overDailyLimit(): boolean {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = JSON.parse(localStorage.getItem(DAILY_LIMIT_KEY) || '{}') as { day?: string; n?: number };
    const n = raw.day === today ? raw.n || 0 : 0;
    if (n >= DAILY_LIMIT) return true;
    localStorage.setItem(DAILY_LIMIT_KEY, JSON.stringify({ day: today, n: n + 1 }));
  } catch {
    // Storage can be blocked; the limit simply doesn't apply then.
  }
  return false;
}

export function useLiveDemo() {
  const [status, setStatus] = useState<DemoStatus>('idle');
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [micState, setMicState] = useState<MicState>('off');
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(INTRO_MAX_SECONDS);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const playHeadRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const pendingRef = useRef<string[]>([]);
  const idRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const turnsRef = useRef(0);
  // Set when the server refuses the session (limits), so the panel goes back to
  // the examples with the message instead of showing a finished call.
  const blockedRef = useRef(false);
  const statusRef = useRef<DemoStatus>('idle');
  // Kept in step with `status` so callbacks can read the current value.
  const updateStatus = useCallback((next: DemoStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const addMessage = useCallback((role: DemoMessage['role'], text: string) => {
    setMessages((prev) => [...prev, { id: ++idRef.current, role, text }]);
  }, []);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((s) => {
      try { s.stop(); } catch { /* already stopped */ }
    });
    sourcesRef.current = [];
    if (ctxRef.current) playHeadRef.current = ctxRef.current.currentTime;
  }, []);

  const playPCM16 = useCallback((buf: ArrayBuffer) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const int16 = new Int16Array(buf);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;
    const audioBuf = ctx.createBuffer(1, float32.length, 24000);
    audioBuf.copyToChannel(float32, 0);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playHeadRef.current);
    src.start(startAt);
    playHeadRef.current = startAt + audioBuf.duration;
    sourcesRef.current.push(src);
  }, []);

  const stopMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    setMicState((m) => (m === 'blocked' ? m : 'off'));
  }, []);

  const startMic = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx || streamRef.current) return;
    setMicState('asking');
    try {
      await ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (!ctxRef.current || statusRef.current === 'ended') {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => {
        const ws = wsRef.current;
        if (ws?.readyState !== WebSocket.OPEN) return;
        const pcm16 = floatToPCM16(downsampleTo16k(e.inputBuffer.getChannelData(0), ctx.sampleRate));
        ws.send(pcm16.buffer);
      };
      src.connect(node);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(ctx.destination);
      nodeRef.current = node;
      setMicState('on');
    } catch {
      setMicState('blocked');
    }
  }, []);

  const teardown = useCallback(() => {
    stopMic();
    stopPlayback();
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'hangup' }));
        ws.close();
      } catch { /* closing */ }
    }
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setAgentSpeaking(false);
  }, [stopMic, stopPlayback]);

  const finish = useCallback(() => {
    if (statusRef.current === 'ended' || statusRef.current === 'idle') return;
    if (blockedRef.current) {
      blockedRef.current = false;
      startedAtRef.current = null;
      teardown();
      updateStatus('idle');
      return;
    }
    if (startedAtRef.current !== null) {
      track('hero_demo_ended', {
        duration_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        turns: turnsRef.current,
      });
      startedAtRef.current = null;
    }
    teardown();
    updateStatus('ended');
  }, [teardown, updateStatus]);

  const start = useCallback(
    (opts: { mic: boolean }) => {
      if (statusRef.current === 'connecting' || statusRef.current === 'live') return;
      if (overDailyLimit()) {
        setError("You've used today's demos in this browser. Try the full setup demo to keep exploring.");
        return;
      }
      setError(null);
      blockedRef.current = false;
      setMessages([]);
      setSecondsLeft(INTRO_MAX_SECONDS);
      turnsRef.current = 0;
      updateStatus('connecting');
      track('hero_demo_started', { input: opts.mic ? 'voice' : 'text' });

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      playHeadRef.current = ctx.currentTime;
      ctx.resume().catch(() => undefined);

      const ws = new WebSocket(getCallLoopWsUrl());
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        startedAtRef.current = Date.now();
        ws.send(
          JSON.stringify({
            type: 'context',
            flow: INTRO_FLOW,
            ttsBackend: 'elevenlabs',
            ttsModel: 'eleven_turbo_v2_5',
          })
        );
        updateStatus('live');
        pendingRef.current.splice(0).forEach((t) => ws.send(JSON.stringify({ type: 'user_text', text: t })));
        if (opts.mic) void startMic();
      };

      ws.onmessage = (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          playPCM16(evt.data);
          return;
        }
        let msg: { type?: string; text?: string; message?: string; code?: string };
        try { msg = JSON.parse(evt.data as string); } catch { return; }
        if (msg.type === 'assistant_turn' && msg.text?.trim()) addMessage('agent', msg.text);
        else if (msg.type === 'user_turn' && msg.text?.trim()) {
          turnsRef.current += 1;
          addMessage('caller', msg.text);
        } else if (msg.type === 'barge_in') stopPlayback();
        else if (msg.type === 'error') {
          // The server's limit errors carry a code and a message written for visitors.
          if (msg.code === 'session_limit') return; // the normal end of the time limit
          if (msg.code) blockedRef.current = true;
          setError(msg.code && msg.message ? msg.message : 'Something went wrong with the demo. Try again.');
        }
      };

      ws.onerror = () => setError("Couldn't reach the demo. Check your connection and try again.");
      ws.onclose = () => finish();
    },
    [addMessage, finish, playPCM16, startMic, stopPlayback, updateStatus]
  );

  const sendText = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      stopPlayback();
      // The server echoes the turn back as a user_turn message, which is what
      // adds it to the transcript, so typed and spoken turns look the same.
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'user_text', text }));
      else pendingRef.current.push(text);
    },
    [stopPlayback]
  );

  const toggleMic = useCallback(() => {
    if (streamRef.current) stopMic();
    else void startMic();
  }, [startMic, stopMic]);

  // Countdown mirrors the server's own call cap, which ends the session.
  useEffect(() => {
    if (status !== 'live') return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Whether the agent is currently talking, from the audio queue itself.
  useEffect(() => {
    if (status !== 'live') return;
    const t = setInterval(() => {
      const ctx = ctxRef.current;
      setAgentSpeaking(!!ctx && playHeadRef.current > ctx.currentTime + 0.05);
    }, 200);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => () => teardown(), [teardown]);

  return { status, messages, micState, agentSpeaking, secondsLeft, error, start, sendText, toggleMic, end: finish };
}
