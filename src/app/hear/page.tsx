import HearForm from './HearForm';
import { HEAR_CONSENT_TEXT, HEAR_CONSENT_VERSION, hearConsentSha256 } from '@/lib/hear';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hear it: get a demo call', description: 'Enter your phone number and our AI voice agent will call you, so you can hear what your callers would hear.' };

export default function HearPage() {
  const enabled = process.env.HEAR_ENABLED === '1' && !!process.env.HEAR_TENANT_ID;
  return (
    <main className="mx-auto max-w-lg px-4 py-12 text-neutral-900">
      <h1 className="mb-2 text-3xl font-semibold">Hear it on your own phone</h1>
      <p className="mb-6 text-neutral-600">Enter your number and our AI voice agent calls you in a few seconds. Ask it anything, or try booking an appointment, and hear what your callers would hear.</p>
      {enabled
        ? <HearForm consentText={HEAR_CONSENT_TEXT} version={HEAR_CONSENT_VERSION} sha256={hearConsentSha256()} />
        : <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-neutral-700">The demo call is not available right now. You can <a className="text-blue-600 underline" href="/demo/talk">talk to it in your browser</a> instead.</p>}
      <p className="mt-6 text-xs text-neutral-500">US numbers only. One call per number per day. See our <a className="underline" href="/privacy">Privacy Policy</a> and <a className="underline" href="/terms">Terms</a>.</p>
    </main>
  );
}
