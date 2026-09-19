import { redirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/outreach/adminAuth';

// Server-side gate for the whole /admin/outreach section — checked here
// (not just per-API-route) so an unauthorized signed-in user is redirected
// before any page even renders, rather than seeing an empty shell that then
// fails its data fetches.
export default async function AdminOutreachLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminSession();
  if (!admin) {
    redirect('/auth/signin?callbackUrl=/admin/outreach');
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-gray-400">Internal</p>
        <h1 className="text-[17px] font-semibold">Outreach</h1>
      </div>
      <main className="p-6">{children}</main>
    </div>
  );
}
