import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { signLinkToken, verifyLinkToken, verifyPickToken } from '@/lib/highlevel/crypto';
import { installUrl } from '@/lib/highlevel/oauth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect HighLevel | CallDeskTech' };

type SP = Record<string, string | undefined>;

const MESSAGES: Record<string, string> = {
  denied: 'The install was cancelled in HighLevel. Nothing was connected.',
  install_failed: 'We could not finish the install with HighLevel. Please try installing the app again.',
  no_location: 'The app was installed for your whole agency, but Calldesk connects one HighLevel sub-account at a time. Choose the specific sub-account to connect.',
};

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight text-[#00122e]">{title}</h1>
      {children}
    </main>
  );
}

export default async function HighLevelLinkPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (sp.done) return <Shell title="HighLevel is connected"><p className="mt-3 text-gray-600">Your HighLevel sub-account is linked to your Calldesk workspace. You can close this tab and return to HighLevel.</p></Shell>;
  if (sp.error) {
    const again = sp.error === 'no_location' ? installUrl() : null;
    return (
      <Shell title="We could not connect HighLevel">
        <p className="mt-3 text-gray-600">{MESSAGES[sp.error] ?? MESSAGES.install_failed}</p>
        {again && (
          <>
            <p className="mt-3 text-gray-600">On the next screen, pick one sub-account instead of the whole agency.</p>
            <a href={again} className="mt-6 inline-block rounded-md bg-[#00122e] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[#0a2450]">Choose a sub-account</a>
          </>
        )}
      </Shell>
    );
  }
  const pick = sp.pick ? verifyPickToken(sp.pick) : null;
  if (pick) {
    return (
      <Shell title="Choose a sub-account">
        <p className="mt-3 text-gray-600">The app was installed for several HighLevel sub-accounts. Choose the one to connect to Calldesk now; come back to this page for the others.</p>
        <ul className="mt-6 space-y-3">
          {pick.map((l) => (
            <li key={l.id}>
              <a href={`/highlevel/link?token=${encodeURIComponent(signLinkToken(l.id))}`} className="block rounded-md border border-gray-300 px-4 py-3 text-[15px] text-[#00122e] hover:bg-gray-50">{l.name}</a>
            </li>
          ))}
        </ul>
      </Shell>
    );
  }
  if (!sp.token || !verifyLinkToken(sp.token)) return <Shell title="This link has expired"><p className="mt-3 text-gray-600">Install the Calldesk app again from HighLevel to get a new link.</p></Shell>;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/highlevel/link?token=${sp.token}`)}`);
  const { data: tenants } = await getSupabaseAdmin().from('calldesk_tenants').select('id, name').eq('user_id', session.user.id).order('created_at');

  return (
    <Shell title="Connect HighLevel to Calldesk">
      <p className="mt-3 text-gray-600">Signed in as {session.user.email}. Choose the Calldesk workspace that your HighLevel sub-account should place calls from.</p>
      {!tenants?.length ? (
        <p className="mt-8 text-gray-600">You have no workspace yet. <a className="text-blue-600 underline" href="/onboarding/business">Create one</a>, then come back to this page.</p>
      ) : (
        <form method="POST" action="/api/highlevel/link" className="mt-8 space-y-6">
          <input type="hidden" name="token" value={sp.token} />
          <div>
            <label htmlFor="tenant_id" className="block text-sm font-medium text-[#00122e]">Workspace</label>
            <select id="tenant_id" name="tenant_id" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2.5 text-[15px]">
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button className="rounded-md bg-[#00122e] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-[#0a2450]">Connect</button>
        </form>
      )}
    </Shell>
  );
}
