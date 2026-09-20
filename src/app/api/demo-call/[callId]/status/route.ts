import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const RETELL_API_URL = 'https://api.retellai.com';

// GET /api/demo-call/[callId]/status - Get call status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const { callId } = await params;

    if (!callId) {
      return NextResponse.json(
        { error: 'Call ID is required' },
        { status: 400 }
      );
    }

    if (/^CA[0-9a-f]{32}$/.test(callId)) return twilioStatus(callId);

    const retellApiKey = process.env.RETELL_API_KEY;
    if (!retellApiKey) {
      return NextResponse.json(
        { error: 'Retell API key not configured' },
        { status: 500 }
      );
    }

    // Get call status from Retell
    const callResponse = await fetch(`${RETELL_API_URL}/v2/get-call/${callId}`, {
      headers: {
        'Authorization': `Bearer ${retellApiKey}`,
      },
    });

    if (!callResponse.ok) {
      // Call might still be in progress or not found yet
      if (callResponse.status === 404) {
        return NextResponse.json({
          call_id: callId,
          status: 'pending',
          duration: 0,
        });
      }

      const errorText = await callResponse.text();
      console.error('Retell API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to get call status' },
        { status: callResponse.status }
      );
    }

    const callData = await callResponse.json();

    // Map Retell status to our status
    let status = 'in-progress';
    if (callData.end_timestamp) {
      status = 'completed';
    } else if (callData.start_timestamp) {
      status = 'in-progress';
    } else {
      status = 'ringing';
    }

    // Calculate duration
    let duration = 0;
    if (callData.start_timestamp && callData.end_timestamp) {
      duration = Math.round((callData.end_timestamp - callData.start_timestamp) / 1000);
    } else if (callData.start_timestamp) {
      duration = Math.round((Date.now() - callData.start_timestamp) / 1000);
    }

    // Parse transcript if available
    let transcript = null;
    if (callData.transcript) {
      // Retell returns transcript as a string, parse it into turns
      transcript = parseTranscript(callData.transcript);
    }

    // Update our database with the latest info if call is completed
    if (status === 'completed') {
      const supabase = getSupabaseAdmin();
      await supabase
        .from('calldesk_call_logs')
        .update({
          duration_seconds: duration,
          transcript: transcript,
          outcome: determineOutcome(callData),
        })
        .eq('retell_call_id', callId);
    }

    return NextResponse.json({
      call_id: callId,
      status,
      duration,
      transcript,
      recording_url: callData.recording_url || null,
    });
  } catch (error) {
    console.error('Error getting call status:', error);
    return NextResponse.json(
      { error: 'Failed to get call status' },
      { status: 500 }
    );
  }
}

function parseTranscript(transcriptString: string): Array<{ role: string; content: string }> {
  // Retell typically returns transcript in format:
  // "Agent: Hello...\nUser: Hi...\nAgent: How can I help?"
  const lines = transcriptString.split('\n').filter(line => line.trim());

  return lines.map(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      return { role: 'agent', content: line.trim() };
    }

    const speaker = line.substring(0, colonIndex).trim().toLowerCase();
    const content = line.substring(colonIndex + 1).trim();

    return {
      role: speaker === 'user' || speaker === 'caller' ? 'user' : 'agent',
      content,
    };
  });
}

function determineOutcome(callData: Record<string, unknown>): string {
  // Analyze call data to determine outcome
  const transcript = (callData.transcript as string || '').toLowerCase();

  if (transcript.includes('appointment') && transcript.includes('confirm')) {
    return 'booked';
  }
  if (transcript.includes('transfer') || transcript.includes('hold')) {
    return 'transferred';
  }
  if (!callData.start_timestamp) {
    return 'abandoned';
  }

  return 'answered';
}

// Calls placed by our own voice engine (Twilio SID): status from call-loop-poc, transcript from our call log.
async function twilioStatus(callId: string) {
  const base = process.env.CALL_LOOP_POC_BASE_URL;
  const secret = process.env.CALL_LOOP_POC_TEST_CALL_SECRET;
  if (!base || !secret) return NextResponse.json({ error: 'Calling is not configured' }, { status: 500 });
  const r = await fetch(`${base}/call-status/${callId}`, { headers: { Authorization: `Bearer ${secret}` } }).then((x) => x.json()).catch(() => ({} as { status?: string; duration?: number }));
  const map: Record<string, string> = { queued: 'ringing', initiated: 'ringing', ringing: 'ringing', 'in-progress': 'in-progress', completed: 'completed', busy: 'busy', 'no-answer': 'no-answer', failed: 'failed', canceled: 'failed' };
  const status = map[r.status as string] || 'ringing';
  let transcript = null;
  if (status === 'completed') {
    const { data } = await getSupabaseAdmin().from('calldesk_call_logs').select('transcript').eq('retell_call_id', callId).maybeSingle();
    if (Array.isArray(data?.transcript)) transcript = data.transcript;
  }
  return NextResponse.json({ call_id: callId, status, duration: r.duration || 0, transcript, recording_url: null });
}
