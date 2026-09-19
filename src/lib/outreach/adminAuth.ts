import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Outreach data isn't tenant-scoped customer data — it's internal sales
// tooling, so it doesn't fit the existing tenant/RLS auth model. Gated
// instead by a plain email allowlist (ADMIN_EMAILS, comma-separated) checked
// against the real NextAuth session, reusing the same session/auth
// machinery as the rest of the app rather than adding a second auth system.
export async function requireAdminSession(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;

  const allowlist = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowlist.includes(email.toLowerCase())) return null;
  return { email };
}
