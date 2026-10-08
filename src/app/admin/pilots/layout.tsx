import { adminGate, AdminDenied } from '@/lib/outreach/adminGate';

// Server-side gate for /admin/pilots and its detail pages, same as /admin/usage.
export default async function AdminPilotsLayout({ children }: { children: React.ReactNode }) {
  const gate = await adminGate('/admin/pilots');
  if ('deniedFor' in gate) return <AdminDenied email={gate.deniedFor} />;
  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-[13px] font-semibold text-gray-400">Internal</p>
        <h1 className="text-[17px] font-semibold">Pilots</h1>
      </div>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
