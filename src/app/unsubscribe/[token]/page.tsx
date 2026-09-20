import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyUnsubscribeToken } from '@/lib/outreach/unsubscribe';

// Public, no login. Visiting a valid signed link adds that one address to the
// suppression list (idempotent). Invalid/tampered links change nothing.
export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let email: string | null = null;
  try {
    email = verifyUnsubscribeToken(decodeURIComponent(token));
  } catch {
    email = null;
  }

  let done = false;
  if (email) {
    const { error } = await getSupabaseAdmin()
      .from('calldesk_outreach_suppressions')
      .upsert({ email, reason: 'unsubscribed via link' }, { onConflict: 'email' });
    done = !error;
  }

  return (
    <main style={{ maxWidth: 480, margin: '96px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif', color: '#1a1d29' }}>
      {done ? (
        <>
          <h1 style={{ fontSize: 20 }}>You&apos;re unsubscribed</h1>
          <p>{email} will not receive further emails from Calldesk outreach.</p>
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
