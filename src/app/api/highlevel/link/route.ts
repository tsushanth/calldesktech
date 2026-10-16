import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyLinkToken } from '@/lib/highlevel/crypto';
import { linkTenant } from '@/lib/highlevel/installs';
import { moveSubscriptionsToTenant } from '@/lib/highlevel/triggers';

// Target of the form on /highlevel/link. Session-only: the person linking must be signed in, must own the workspace,
// and must hold the signed token that /api/highlevel/oauth/callback gave the browser that just installed the app.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const form = await req.formData();
  const token = String(form.get('token') || '');
  const tenantId = String(form.get('tenant_id') || '');
  const locationId = verifyLinkToken(token);
  if (!locationId) return NextResponse.json({ error: 'This link has expired. Install the app again from HighLevel.' }, { status: 400 });

  const { data: tenant } = await getSupabaseAdmin().from('calldesk_tenants').select('id').eq('id', tenantId).eq('user_id', session.user.id).maybeSingle();
  if (!tenant) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  if (!(await linkTenant(locationId, tenant.id))) return NextResponse.json({ error: 'No active HighLevel install for this link. Install the app again from HighLevel.' }, { status: 409 });
  // If this sub-account was linked to another workspace before, its trigger webhooks follow the link.
  await moveSubscriptionsToTenant(locationId, tenant.id).catch((e) => console.error('[highlevel] could not move trigger subscriptions:', e instanceof Error ? e.message : 'error'));
  // The public origin, not req.nextUrl.origin: behind the Fly proxy the request URL says http://0.0.0.0:3000.
  const done = new URL('/highlevel/link', new URL(process.env.HIGHLEVEL_REDIRECT_URI || 'https://calldesk.tech/').origin);
  done.searchParams.set('done', '1');
  return NextResponse.redirect(done.toString(), 303);
}
