import type { Metadata } from 'next';
import Link from 'next/link';
import { CONSENT_VERSION, FORM_COPY, consentSha256 } from '@/lib/outreach/smsConsent';
import { verifySampleToken } from '@/lib/outreach/samples';
import { headers } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { clientIpFrom } from '@/lib/outreach/sampleEvents';
import { recordPageView } from '@/lib/outreach/deckEvents';
import TryForm from './TryForm';

export const metadata: Metadata = {
  title: 'Try Calldesk | Trial coupon',
  description: 'Get a trial coupon for Calldesk AI phone agents.',
  robots: { index: false, follow: false },
};

// Link-only page: the outreach email carries a signed per-message token (?t=). No token or a bad token shows a plain notice.
export default async function TryPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const token = typeof t === 'string' ? t : '';
  const valid = !!verifySampleToken(token);
  if (valid) {
    const h = await headers();
    await recordPageView(getSupabaseAdmin(), { token, event: 'try_view', userAgent: h.get('user-agent'), ip: clientIpFrom(h) });
  }
  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">{FORM_COPY.headline}</h1>
        <p className="mb-6 text-neutral-600">{FORM_COPY.intro}</p>
        {valid ? <TryForm token={token} copy={{ ...FORM_COPY }} consentVersion={CONSENT_VERSION} consentSha256={consentSha256()} /> : (
          <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-700">
            This page works from the link in our email. Open that link again, or <Link className="text-blue-600 underline" href="/demo">try the free demo</Link>.
          </div>
        )}
      </div>
    </main>
  );
}
