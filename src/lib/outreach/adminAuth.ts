import { getServerSession } from 'next-auth';
import { timingSafeEqual } from 'crypto';
import { authOptions } from '@/lib/auth';
import { adminEmails } from './config';

// Outreach data isn't tenant-scoped customer data — it's internal sales
// tooling, so it doesn't fit the existing tenant/RLS auth model. Gated
// instead by a plain email allowlist (ADMIN_EMAILS, comma-separated) checked
// against the real NextAuth session, reusing the same session/auth
// machinery as the rest of the app rather than adding a second auth system.
export async function requireAdminSession(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;

  const allowlist = adminEmails();
  if (!allowlist.includes(email.toLowerCase())) return null;
  return { email };
}

// The daily harness (GitHub Actions cron) has no browser session, so it
// authenticates with a shared secret instead. Constant-time compare; an unset
// CRON_SECRET never matches anything.
export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
