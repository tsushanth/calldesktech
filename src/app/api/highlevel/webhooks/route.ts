import { NextRequest, NextResponse } from 'next/server';
import { handleAppWebhook } from '@/lib/highlevel/appWebhooks';
import { GHL_SIGNATURE_HEADER, verifyGhlSignature } from '@/lib/highlevel/webhookSignature';

// HighLevel app webhooks (Advanced Settings, Webhooks in the developer portal). The signature is checked over the exact bytes received,
// before the body is parsed. A valid signature on an event we do not act on still gets a 200 so HighLevel does not retry it.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyGhlSignature(raw, req.headers.get(GHL_SIGNATURE_HEADER))) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }
  try {
    const handled = await handleAppWebhook(payload);
    return NextResponse.json({ ok: true, handled });
  } catch (e) {
    console.error('[highlevel] webhook failed:', e instanceof Error ? e.message : 'error');
    return NextResponse.json({ error: 'Could not process the event' }, { status: 500 }); // 5xx so HighLevel retries
  }
}
