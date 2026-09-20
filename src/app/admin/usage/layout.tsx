import { redirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/outreach/adminAuth';

export default async function AdminUsageLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminSession();
  if (!admin) redirect('/auth/signin?callbackUrl=/admin/usage');
  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-[13px] font-semibold text-gray-400">Internal</p>
        <h1 className="text-[17px] font-semibold">Product usage</h1>
      </div>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
