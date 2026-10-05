import type { Metadata } from 'next';
import Link from 'next/link';
import { CONSENT_TEXT } from '@/lib/outreach/smsConsent';
import { verifySampleToken } from '@/lib/outreach/samples';
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
  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">Try Calldesk</h1>
        <p className="mb-6 text-neutral-600">Get a trial coupon for your first Calldesk invoice. Enter your mobile number and we will show it right away.</p>
        {valid ? <TryForm token={token} consentText={CONSENT_TEXT} /> : (
          <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-700">
            This page works from the link in our email. Open that link again, or <Link className="text-blue-600 underline" href="/demo">try the free demo</Link>.
          </div>
        )}
      </div>
    </main>
  );
}
