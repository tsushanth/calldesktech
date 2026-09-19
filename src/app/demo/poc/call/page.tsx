'use client';

// The "poc" voice-engine demo call — same demo UX shell as the Retell flow,
// but talks directly to call-loop-poc over WebSocket in-browser instead of
// placing a real outbound PSTN call. See src/lib/voiceEngine.ts for how this
// gets selected, and ../../../../call-loop-poc/README.md for the "context"
// message protocol this page sends on connect.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useOnboarding } from '@/context/OnboardingContext';
import { CAPABILITY_DEMOS } from '@/lib/constants';
import { getCallLoopWsUrl } from '@/lib/voiceEngine';
import { api } from '@/lib/api';

type LogLine = { text: string; cls: 'user' | 'assistant' | 'muted' };

function buildSystemPrompt(businessName: string, businessType: string, voiceStyle: string) {
  return (
    `You are an AI receptionist for ${businessName}, a ${businessType} business. ` +
    `Tone: ${voiceStyle}. Keep replies to 1-2 short sentences unless asked for more detail. ` +
    `Never use markdown, bullet points, or emoji — this is spoken audio. ` +
    `Help the caller book an appointment, answer questions about services, and hours.`
  );
}

function downsampleTo16k(input: Float32Array, inputRate: number) {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = input[Math.floor(i * ratio)];
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

export default function PocDemoCallPage() {
  const router = useRouter();
  const { selectedProfileId, demoType, businessName: focusedBusinessName, tenantId, agentFlow } = useOnboarding();

  const profile = selectedProfileId ? CAPABILITY_DEMOS[selectedProfileId] : null;
  const businessName = demoType === 'focused' ? focusedBusinessName || 'Your business' : profile?.businessName || 'Demo Business';
  const businessType = profile?.businessType || 'general';
  const voiceStyle = profile?.voiceStyle || 'Warm, professional voice';
  const greeting = profile?.greeting || `Thanks for calling ${businessName}, how can I help you today?`;

  // The WS-connect effect below intentionally runs once on mount (empty dep
  // array — we don't want to reconnect mid-call if this object's identity
  // changes). But right after router.push() into this page, OnboardingContext
  // can still be mid-hydration for one render, so the *first* render's
  // businessName/greeting can be the "Demo Business" fallback even though the
  // real profile data arrives a beat later. Keep a ref in sync with every
  // render so the effect always sends whatever the latest values actually are,
  // not whatever they were the instant the effect happened to fire.
  const contextInfoRef = useRef({ businessName, businessType, voiceStyle, greeting });
  useEffect(() => {
    contextInfoRef.current = { businessName, businessType, voiceStyle, greeting };
  }, [businessName, businessType, voiceStyle, greeting]);

  // Real synthesized flow from the wizard's building-block toggles (see
  // OnboardingContext.agentFlow) — when present, this drives the call
  // instead of the generic systemPrompt/greeting pair below, so a focused
  // demo actually exercises whichever blocks (booking/transfer/take-message)
  // the business owner chose, not a one-size-fits-all prompt. Sample demos
  // have no agent/flow, so this stays null for them.
  const agentFlowRef = useRef(agentFlow);
  useEffect(() => {
    agentFlowRef.current = agentFlow;
  }, [agentFlow]);

  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playHeadRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micNodeRef = useRef<ScriptProcessorNode | null>(null);

  const appendLog = useCallback((text: string, cls: LogLine['cls']) => {
    setLog((prev) => [...prev, { text, cls }]);
  }, []);

  const stopPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    });
    activeSourcesRef.current = [];
    if (audioCtxRef.current) playHeadRef.current = audioCtxRef.current.currentTime;
  }, []);

  const playPCM16 = useCallback(async (buf: ArrayBuffer, sampleRate: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const int16 = new Int16Array(buf);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;
    const audioBuf = ctx.createBuffer(1, float32.length, sampleRate);
    audioBuf.copyToChannel(float32, 0);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playHeadRef.current);
    src.start(startAt);
    playHeadRef.current = startAt + audioBuf.duration;
    activeSourcesRef.current.push(src);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      playHeadRef.current = ctx.currentTime;

      const ws = new WebSocket(getCallLoopWsUrl());
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = async () => {
        if (cancelled) return;
        setConnected(true);
        const info = contextInfoRef.current;
        appendLog(`connected to ${info.businessName}'s AI receptionist`, 'muted');

        // Per-tenant TTS backend (set on the dashboard Settings page) —
        // falls back to call-loop-poc's own process default when there's no
        // tenant yet (sample demos) or the tenant hasn't set one.
        let ttsBackend: string | undefined;
        if (tenantId) {
          try {
            const tenant = await api.getTenant(tenantId);
            const settings = tenant?.settings as { tts_backend?: string } | null;
            if (settings?.tts_backend === 'elevenlabs' || settings?.tts_backend === 'kokoro') {
              ttsBackend = settings.tts_backend;
            }
          } catch (err) {
            console.error('Failed to load tenant tts_backend, using server default:', err);
          }
        }
        if (cancelled) return;

        const flow = agentFlowRef.current;
        ws.send(
          JSON.stringify({
            type: 'context',
            ...(flow
              ? { flow }
              : {
                  systemPrompt: buildSystemPrompt(info.businessName, info.businessType, info.voiceStyle),
                  greeting: info.greeting,
                }),
            ...(ttsBackend ? { ttsBackend } : {}),
          })
        );

        try {
          await ctx.resume();
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
          if (cancelled) return;
          micStreamRef.current = stream;
          const src = ctx.createMediaStreamSource(stream);
          const node = ctx.createScriptProcessor(4096, 1, 1);
          node.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const down = downsampleTo16k(input, ctx.sampleRate);
            const pcm16 = floatToPCM16(down);
            if (ws.readyState === WebSocket.OPEN) ws.send(pcm16.buffer);
          };
          src.connect(node);
          const silentSink = ctx.createGain();
          silentSink.gain.value = 0;
          node.connect(silentSink);
          silentSink.connect(ctx.destination);
          micNodeRef.current = node;
        } catch (err) {
          appendLog(`[mic error] ${err instanceof Error ? err.message : String(err)}`, 'muted');
        }
      };

      ws.onmessage = (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          playPCM16(evt.data, 24000);
          return;
        }
        const msg = JSON.parse(evt.data);
        if (msg.type === 'user_turn') appendLog(msg.text, 'user');
        else if (msg.type === 'tts_event' && msg.event?.type === 'chunk_meta') appendLog(msg.event.text, 'assistant');
        else if (msg.type === 'barge_in') stopPlayback();
        else if (msg.type === 'error') appendLog(`[error] ${msg.message}`, 'muted');
      };

      ws.onclose = () => {
        setConnected(false);
        setEnded(true);
      };
    }

    start();

    return () => {
      cancelled = true;
      // send() throws InvalidStateError if the socket is still mid-handshake
      // (readyState CONNECTING) — real in dev, where React Strict Mode
      // double-invokes this effect (mount -> cleanup -> mount again), so the
      // first mount's cleanup can run before its own socket ever opens.
      // close() is always safe regardless of readyState.
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'hangup' }));
      }
      wsRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micNodeRef.current?.disconnect();
      audioCtxRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hangUp = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'hangup' }));
    }
    wsRef.current?.close();
  };

  return (
    <div className="min-h-[calc(100vh-72px)] bg-white py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-4 text-center">
          <span className="inline-block text-xs font-medium text-amber-700 bg-amber-100 rounded-full px-3 py-1">
            POC voice engine — in-browser, no phone call placed
          </span>
        </div>

        <Card className="text-center mb-4">
          <div className={`w-20 h-20 ${profile?.color ?? 'bg-gray-200'} rounded-full flex items-center justify-center text-4xl mx-auto mb-4`}>
            {profile?.icon ?? '🤖'}
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-1">{businessName}</h2>
          <p className="text-gray-500 mb-4">
            {ended ? 'Call ended' : connected ? 'Talk now — try booking an appointment' : 'Connecting...'}
          </p>
          {!ended && (
            <Button variant="secondary" onClick={hangUp}>
              Hang up
            </Button>
          )}
          {ended && <Button onClick={() => router.push('/demo/sample')}>Back to demo</Button>}
        </Card>

        <Card className="text-left">
          <div className="font-mono text-xs space-y-1 max-h-80 overflow-y-auto">
            {log.length === 0 && <p className="text-gray-400">Waiting for the call to connect...</p>}
            {log.map((line, i) => (
              <p
                key={i}
                className={
                  line.cls === 'user' ? 'text-blue-600' : line.cls === 'assistant' ? 'text-amber-700' : 'text-gray-400'
                }
              >
                {line.cls === 'user' ? 'you: ' : line.cls === 'assistant' ? 'assistant: ' : ''}
                {line.text}
              </p>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
