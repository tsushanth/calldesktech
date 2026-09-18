import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { deliverWebhook } from '@/lib/webhooks';
import { authorizeTenant } from '@/lib/authz';

// POST /api/tenants/[id]/webhooks/[webhookId]/test — send a real, signed
// `webhook.test` ping to the stored endpoint and report whether it accepted
// it. This is a genuine outbound request signed with the endpoint's secret,
// so the tenant can confirm both reachability and signature verification.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; webhookId: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId, webhookId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: webhook, error } = await supabase
    .from('calldesk_webhooks')
    .select('id, url, secret')
    .eq('id', webhookId)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }

  const result = await deliverWebhook(webhook, 'webhook.test', {
    message: 'This is a test event from CallDesk.',
    tenant_id: tenantId,
    webhook_id: webhook.id,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        status: result.status,
        error:
          result.error ??
          `Endpoint responded with ${result.status ?? 'no status'}`,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ success: true, status: result.status });
}
