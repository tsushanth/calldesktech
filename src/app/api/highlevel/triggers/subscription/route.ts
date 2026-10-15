import { NextRequest, NextResponse } from 'next/server';
import { requireAppSecret } from '@/lib/highlevel/appAuth';
import { getInstall } from '@/lib/highlevel/installs';
import { applySubscription, type SubscriptionEvent } from '@/lib/highlevel/triggers';

// HighLevel "Subscription URL" for the trigger "Calldesk call completed": called when a workflow starts, changes or stops using it.
// Authenticated by the shared app secret (header, or ?k= in the URL as HighLevel may not send custom headers here), so nobody can
// subscribe a workspace's call results to a URL of their choosing.
export async function POST(req: NextRequest) {
  const denied = requireAppSecret(req);
  if (denied) return denied;

  let evt: SubscriptionEvent;
  try {
    evt = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const locationId = evt?.extras?.locationId;
  if (typeof locationId !== 'string' || !locationId) return NextResponse.json({ error: 'extras.locationId is missing' }, { status: 400 });

  const install = await getInstall(locationId);
  if (!install || install.status !== 'active') return NextResponse.json({ error: 'The Calldesk app is not installed on this sub-account' }, { status: 404 });
  if (!install.tenant_id) return NextResponse.json({ error: 'This sub-account is not linked to a Calldesk workspace yet' }, { status: 409 });

  const result = await applySubscription(evt, install.tenant_id, locationId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
