import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const RETELL_API_URL = 'https://api.retellai.com';

// GET /api/demo-call/[callId]/transcript - Get full transcript with insights
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

    const retellApiKey = process.env.RETELL_API_KEY;
    if (!retellApiKey) {
      return NextResponse.json(
        { error: 'Retell API key not configured' },
        { status: 500 }
      );
    }

    // Get call data from Retell
    const callResponse = await fetch(`${RETELL_API_URL}/v2/get-call/${callId}`, {
      headers: {
        'Authorization': `Bearer ${retellApiKey}`,
      },
    });

    if (!callResponse.ok) {
      if (callResponse.status === 404) {
        return NextResponse.json(
          { error: 'Call not found' },
          { status: 404 }
        );
      }

      const errorText = await callResponse.text();
      console.error('Retell API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to get call data' },
        { status: callResponse.status }
      );
    }

    const callData = await callResponse.json();

    // Get tenant info from our database
    const supabase = getSupabaseAdmin();
    const { data: callLog } = await supabase
      .from('calldesk_call_logs')
      .select('*, tenants(name)')
      .eq('retell_call_id', callId)
      .single();

    const businessName = callLog?.tenants?.name || 'Your Business';
    const tenantId = callLog?.tenant_id || '';

    // Calculate duration
    let duration = 0;
    if (callData.start_timestamp && callData.end_timestamp) {
      duration = Math.round((callData.end_timestamp - callData.start_timestamp) / 1000);
    }

    // Parse transcript into turns
    const transcript = parseTranscriptToTurns(callData.transcript || '');

    // Generate AI summary and insights from transcript
    const { summary, caller_intent, actions_demonstrated, caller_insights } =
      await generateInsights(callData.transcript || '', businessName);

    // Build response
    const response = {
      call_id: callId,
      tenant_id: tenantId,
      business_name: businessName,
      duration,
      started_at: callData.start_timestamp ? new Date(callData.start_timestamp).toISOString() : undefined,
      ended_at: callData.end_timestamp ? new Date(callData.end_timestamp).toISOString() : undefined,
      transcript,
      summary,
      caller_intent,
      actions_demonstrated,
      caller_insights,
      turn_count: transcript.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error getting transcript:', error);
    return NextResponse.json(
      { error: 'Failed to get transcript' },
      { status: 500 }
    );
  }
}

interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  turn_number: number;
}

function parseTranscriptToTurns(transcriptString: string): TranscriptTurn[] {
  if (!transcriptString) return [];

  const lines = transcriptString.split('\n').filter(line => line.trim());

  return lines.map((line, index) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      return {
        role: 'assistant' as const,
        text: line.trim(),
        turn_number: index + 1,
      };
    }

    const speaker = line.substring(0, colonIndex).trim().toLowerCase();
    const text = line.substring(colonIndex + 1).trim();

    return {
      role: (speaker === 'user' || speaker === 'caller' ? 'user' : 'assistant') as 'user' | 'assistant',
      text,
      turn_number: index + 1,
    };
  });
}

interface InsightsResult {
  summary: string;
  caller_intent: string;
  actions_demonstrated: string[];
  caller_insights: {
    sentiment: string;
    urgency: string;
    decision_style: string;
    purchase_intent: string;
    price_sensitivity: string;
    key_concerns: string[];
    upsell_opportunities: string[];
    follow_up_recommendation: string;
    caller_profile_summary: string;
  };
}

async function generateInsights(transcript: string, businessName: string): Promise<InsightsResult> {
  // Analyze the transcript to extract insights
  // In production, this would use an LLM API for more sophisticated analysis

  const lowerTranscript = transcript.toLowerCase();

  // Determine caller intent
  let caller_intent = 'General Inquiry';
  if (lowerTranscript.includes('appointment') || lowerTranscript.includes('book') || lowerTranscript.includes('schedule')) {
    caller_intent = 'Book Appointment';
  } else if (lowerTranscript.includes('price') || lowerTranscript.includes('cost') || lowerTranscript.includes('how much')) {
    caller_intent = 'Pricing Inquiry';
  } else if (lowerTranscript.includes('hours') || lowerTranscript.includes('open') || lowerTranscript.includes('available')) {
    caller_intent = 'Hours/Availability';
  } else if (lowerTranscript.includes('emergency') || lowerTranscript.includes('urgent')) {
    caller_intent = 'Emergency Service';
  }

  // Determine sentiment
  let sentiment = 'Neutral';
  if (lowerTranscript.includes('thank') || lowerTranscript.includes('great') || lowerTranscript.includes('perfect') || lowerTranscript.includes('excellent')) {
    sentiment = 'Positive';
  } else if (lowerTranscript.includes('frustrated') || lowerTranscript.includes('angry') || lowerTranscript.includes('terrible') || lowerTranscript.includes('awful')) {
    sentiment = 'Negative';
  }

  // Determine urgency
  let urgency = 'Low';
  if (lowerTranscript.includes('emergency') || lowerTranscript.includes('urgent') || lowerTranscript.includes('asap') || lowerTranscript.includes('right now')) {
    urgency = 'Emergency';
  } else if (lowerTranscript.includes('soon') || lowerTranscript.includes('today') || lowerTranscript.includes('tomorrow')) {
    urgency = 'High';
  } else if (lowerTranscript.includes('week') || lowerTranscript.includes('whenever')) {
    urgency = 'Medium';
  }

  // Determine purchase intent
  let purchase_intent = 'Exploring';
  if (lowerTranscript.includes('ready') || lowerTranscript.includes('want to book') || lowerTranscript.includes('schedule')) {
    purchase_intent = 'Ready to Buy';
  } else if (lowerTranscript.includes('comparing') || lowerTranscript.includes('other options')) {
    purchase_intent = 'Comparing';
  }

  // Determine price sensitivity
  let price_sensitivity = 'Moderate';
  if (lowerTranscript.includes('budget') || lowerTranscript.includes('cheapest') || lowerTranscript.includes('affordable')) {
    price_sensitivity = 'High';
  } else if (lowerTranscript.includes('quality') || lowerTranscript.includes('best')) {
    price_sensitivity = 'Low';
  }

  // Extract key concerns
  const key_concerns: string[] = [];
  if (lowerTranscript.includes('wait') || lowerTranscript.includes('long')) {
    key_concerns.push('Wait time concerns');
  }
  if (lowerTranscript.includes('price') || lowerTranscript.includes('cost')) {
    key_concerns.push('Cost of services');
  }
  if (lowerTranscript.includes('experience') || lowerTranscript.includes('qualified')) {
    key_concerns.push('Provider qualifications');
  }
  if (key_concerns.length === 0) {
    key_concerns.push('None identified');
  }

  // Identify actions demonstrated
  const actions_demonstrated: string[] = [];
  if (lowerTranscript.includes('hello') || lowerTranscript.includes('hi') || lowerTranscript.includes('thank you for calling')) {
    actions_demonstrated.push('Professional Greeting');
  }
  if (lowerTranscript.includes('appointment') || lowerTranscript.includes('schedule')) {
    actions_demonstrated.push('Appointment Scheduling');
  }
  if (lowerTranscript.includes('question') || lowerTranscript.includes('help')) {
    actions_demonstrated.push('Question Handling');
  }
  if (lowerTranscript.includes('anything else') || lowerTranscript.includes('other questions')) {
    actions_demonstrated.push('Follow-up Courtesy');
  }
  if (actions_demonstrated.length === 0) {
    actions_demonstrated.push('Call Handling');
  }

  // Generate summary
  const summary = `The caller contacted ${businessName} with a ${caller_intent.toLowerCase()} request. The conversation was handled professionally by the AI receptionist, addressing the caller's needs with ${sentiment.toLowerCase()} outcomes.`;

  // Generate profile summary
  const caller_profile_summary = `${sentiment} caller with ${urgency.toLowerCase()} urgency, showing ${purchase_intent.toLowerCase()} purchase intent and ${price_sensitivity.toLowerCase()} price sensitivity.`;

  // Generate follow-up recommendation
  let follow_up_recommendation = 'Standard follow-up call within 24-48 hours.';
  if (urgency === 'Emergency' || urgency === 'High') {
    follow_up_recommendation = 'Immediate callback recommended. High priority customer.';
  } else if (purchase_intent === 'Ready to Buy') {
    follow_up_recommendation = 'Follow up within 2-4 hours to confirm booking and answer any remaining questions.';
  }

  return {
    summary,
    caller_intent,
    actions_demonstrated,
    caller_insights: {
      sentiment,
      urgency,
      decision_style: 'Direct',
      purchase_intent,
      price_sensitivity,
      key_concerns,
      upsell_opportunities: ['Premium service package', 'Maintenance plan'],
      follow_up_recommendation,
      caller_profile_summary,
    },
  };
}
