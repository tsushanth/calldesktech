import { NextResponse } from 'next/server';
import { getRetellClient } from '@/lib/retell';

// GET /api/retell/voices — the full multi-provider voice catalog Retell can
// hand to an agent (elevenlabs, openai, cartesia, minimax, fish_audio,
// platform), not just the two hardcoded ElevenLabs voices this app used to
// offer. Server-side so RETELL_API_KEY never reaches the browser, same
// pattern as every other Retell-backed route.
export async function GET() {
  try {
    const voices = await getRetellClient().listVoices();
    return NextResponse.json({ voices });
  } catch (error) {
    console.error('Failed to list Retell voices:', error);
    return NextResponse.json({ error: 'Failed to load voices' }, { status: 500 });
  }
}
