import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdminSession } from './adminAuth';

// Gate for the /admin/* layouts. Three cases, and they must stay distinct:
//   - not signed in            -> send to sign-in (the sign-in page then returns here)
//   - signed in, not an admin  -> show a "no access" page. NEVER redirect to sign-in: the sign-in page forwards any signed-in user straight
//                                 back to the callback address, which redirected to sign-in again, forever (an infinite redirect loop).
//   - signed in, an admin      -> continue
export async function adminGate(callbackUrl: string): Promise<{ email: string } | { deniedFor: string }> {
  const admin = await requireAdminSession();
  if (admin) return admin;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return { deniedFor: email };
}

export function AdminDenied({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f8fa] p-6 text-[#1a1d29]" data-testid="admin-denied">
      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-[17px] font-semibold">No access to the admin pages</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
          You are signed in as <strong>{email}</strong>, which is not on the admin list. Ask the owner to add this address, or sign in with a different Google account.
        </p>
        {/* NextAuth sign-out is an API route, not a page, so a plain link is correct here */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/auth/signout?callbackUrl=/auth/signin" className="mt-4 inline-block text-[14px] font-medium text-blue-600 underline underline-offset-4">Sign out</a>
      </div>
    </div>
  );
}
