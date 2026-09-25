import { verifyUnsubscribeToken } from '@/lib/outreach/unsubscribe';

// Public, no login. Loading this page changes nothing: email link scanners
// prefetch every URL and would otherwise unsubscribe real recipients. The
// button posts to /api/unsubscribe/[token], which does the suppression.
export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  let email: string | null = null;
  try {
    email = verifyUnsubscribeToken(decodeURIComponent(token));
  } catch {
    email = null;
  }

  return (
    <main style={{ maxWidth: 480, margin: '96px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif', color: '#1a1d29' }}>
      {email && done ? (
        <>
          <h1 style={{ fontSize: 20 }}>You&apos;re unsubscribed</h1>
          <p>{email} will not receive further emails from Calldesk outreach.</p>
        </>
      ) : email ? (
        <>
          <h1 style={{ fontSize: 20 }}>Unsubscribe from Calldesk emails?</h1>
          <p>{email} will stop receiving our outreach emails.</p>
          <form method="post" action={`/api/unsubscribe/${token}`}>
            <button type="submit" style={{ padding: '10px 18px', fontSize: 15, cursor: 'pointer' }}>Unsubscribe</button>
          </form>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 20 }}>This link isn&apos;t valid</h1>
          <p>If you want to stop receiving our emails, reply to any of them and say so, and we&apos;ll remove you.</p>
        </>
      )}
    </main>
  );
}
