import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { RetellWebhookEvent } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const event = (await request.json()) as RetellWebhookEvent;
    const supabase = getSupabaseAdmin();

    // Find tenant by agent ID
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('retell_agent_id', event.call.agent_id)
      .single();

    if (!tenant) {
      console.error('No tenant found for agent:', event.call.agent_id);
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    switch (event.event) {
      case 'call_started':
        // Log call start
        await supabase.from('call_logs').insert({
          tenant_id: tenant.id,
          retell_call_id: event.call.call_id,
          caller_phone: event.call.from_number,
          outcome: 'answered', // Will be updated on call_ended
          duration_seconds: 0,
        });
        break;

      case 'call_ended':
        // Update call log with duration
        const duration = event.call.end_timestamp && event.call.start_timestamp
          ? Math.floor((event.call.end_timestamp - event.call.start_timestamp) / 1000)
          : 0;

        await supabase
          .from('call_logs')
          .update({
            duration_seconds: duration,
            transcript: event.call.transcript ? [{ role: 'system', content: event.call.transcript }] : null,
          })
          .eq('retell_call_id', event.call.call_id);
        break;

      case 'call_analyzed':
        // Update with analysis results and extracted data
        // This is where booking data would be extracted
        break;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Retell webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
