import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { validRedirectUri } from '@/lib/oauth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect an app | CallDeskTech' };

type SP = Record<string, string | undefined>;

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }
  const db = getSupabaseAdmin();
  const { data: client } = await db.from('calldesk_oauth_clients').select('client_name, redirect_uris').eq('client_id', sp.client_id || '').maybeSingle();
  const bad = !client || !sp.redirect_uri || !client.redirect_uris.includes(sp.redirect_uri) || !validRedirectUri(sp.redirect_uri) || sp.response_type !== 'code' || sp.code_challenge_method !== 'S256' || !sp.code_challenge;
  if (bad) {
    return (
      <main className="mx-auto max-w-md px-6 py-24">
        <h1 className="text-2xl font-semibold text-[#00122e]">This connection request is invalid</h1>
        <p className="mt-3 text-gray-600">The app that sent you here did not send a valid request. Close this tab and try connecting again from the app.</p>
      </main>
    );
  }
  const { data: tenants } = await db.from('calldesk_tenants').select('id, name').eq('user_id', session.user.id).order('created_at');
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method'] as const;

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight text-[#00122e]">Connect {client!.client_name} to CallDeskTech</h1>
      <p className="mt-3 text-gray-600">Signed in as {session.user.email}. This app will be able to read and change agents, numbers, knowledge bases and webhooks in the workspace you pick, and place calls that are billed to it. You can revoke access any time under Settings, API Keys.</p>
      {!tenants?.length ? (
        <p className="mt-8 text-gray-600">You have no workspace yet. <a className="text-blue-600 underline" href="/onboarding/business">Create one</a>, then try again.</p>
      ) : (
        <form method="POST" action="/api/oauth/authorize" className="mt-8 space-y-6">
          {hidden.map((k) => <input key={k} type="hidden" name={k} value={sp[k] || ''} />)}
          <div>
            <label htmlFor="tenant_id" className="block text-sm font-medium text-[#00122e]">Workspace</label>
            <select id="tenant_id" name="tenant_id" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2.5 text-[15px]">
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button name="decision" value="approve" className="rounded-md bg-[#00122e] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[#0a2450]">Allow access</button>
            <button name="decision" value="deny" className="rounded-md border border-gray-300 px-5 py-2.5 text-[14px] font-medium text-[#00122e] hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}
    </main>
  );
}
