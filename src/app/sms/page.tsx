import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SMS Terms | CallDeskTech',
  description: 'Opt-in details for CallDeskTech SMS updates and support.',
};

export default function SmsOptInPage() {
  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          SMS Updates from CallDeskTech
        </h1>
        <p className="text-neutral-600 mb-8">
          Customer service, trial setup links, and account updates via text.
        </p>

        <section className="bg-white rounded-xl border border-neutral-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">📱 How to subscribe</h2>
          <p className="mb-3">
            Text <strong>START</strong> to{' '}
            <a href="tel:+18559152245" className="text-blue-600 font-medium">
              +1 (855) 915-2245
            </a>
            ,{' '}
            <a href="tel:+12705609480" className="text-blue-600 font-medium">
              +1 (270) 560-9480
            </a>
            , or{' '}
            <a href="tel:+12245061194" className="text-blue-600 font-medium">
              +1 (224) 506-1194
            </a>
            .
          </p>
          <p className="text-sm text-neutral-600">
            You can also opt in by filling out the form on this page or by
            initiating contact through our{' '}
            <a href="/demo" className="text-blue-600 underline">
              trial signup
            </a>
            .
          </p>
        </section>

        <section className="bg-white rounded-xl border border-neutral-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">📬 What you'll receive</h2>
          <ul className="list-disc list-inside space-y-2 text-neutral-700">
            <li>Trial setup links and onboarding guidance</li>
            <li>Account configuration confirmations</li>
            <li>Appointment scheduling updates</li>
            <li>Technical support responses</li>
          </ul>
          <p className="mt-4 text-sm text-neutral-600">
            Message frequency varies based on your activity. Typically 1–3
            messages per interaction.
          </p>
        </section>

        <section className="bg-white rounded-xl border border-neutral-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">🚪 How to opt out</h2>
          <p className="mb-3">
            Reply <strong>STOP</strong> to any message to unsubscribe
            immediately. You may also reply <strong>UNSUBSCRIBE</strong>.
          </p>
          <p className="text-sm text-neutral-600">
            After opting out, you will receive a confirmation and then no further
            messages.
          </p>
        </section>

        <section className="bg-white rounded-xl border border-neutral-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">❓ Need help?</h2>
          <p className="mb-3">
            Reply <strong>HELP</strong> to any message for assistance, or contact
            us at{' '}
            <a href="mailto:t.sushanth@gmail.com" className="text-blue-600">
              t.sushanth@gmail.com
            </a>
            .
          </p>
          <p className="text-sm text-neutral-600">
            Msg&amp;data rates may apply. Consent is not a condition of purchase.
          </p>
        </section>

        <section className="bg-white rounded-xl border border-neutral-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">📄 Legal</h2>
          <p className="text-sm text-neutral-600 mb-2">
            <strong>Operated by:</strong> KREATIVEKOALASOLUTIONS LLC (DBA
            CallDeskTech)
          </p>
          <p className="text-sm text-neutral-600 mb-2">
            <strong>Address:</strong> 5900 Balcones Dr Ste 100, Austin, TX 78731
          </p>
          <p className="text-sm text-neutral-600 mb-2">
            <strong>Support email:</strong>{' '}
            <a href="mailto:t.sushanth@gmail.com">t.sushanth@gmail.com</a>
          </p>
          <p className="text-sm text-neutral-600">
            <strong>Support phone:</strong>{' '}
            <a href="tel:+18559152245">(855) 915-2245</a>
          </p>
        </section>

        <div className="flex gap-4 text-sm">
          <a href="/privacy" className="text-blue-600 underline">
            Privacy Policy
          </a>
          <a href="/terms" className="text-blue-600 underline">
            Terms of Service
          </a>
        </div>
      </div>
    </main>
  );
}
