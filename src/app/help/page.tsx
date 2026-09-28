import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Help | CallDeskTech',
  description: 'Get help with your CallDeskTech AI receptionist.',
};

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Need help?
        </h1>
        <p className="text-neutral-600 mb-8">
          We&apos;re here to get your AI receptionist working perfectly.
        </p>

        <section className="bg-white rounded-xl border border-neutral-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">📧 Email us</h2>
          <p className="mb-2">
            <a href="mailto:t.sushanth@gmail.com" className="text-blue-600">
              t.sushanth@gmail.com
            </a>
          </p>
          <p className="text-sm text-neutral-600">
            We typically reply within one business day.
          </p>
        </section>

        <section className="bg-white rounded-xl border border-neutral-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">📱 Text us</h2>
          <p className="mb-2">
            <a href="tel:+18559152245" className="text-blue-600 font-medium">
              +1 (855) 915-2245
            </a>
          </p>
          <p className="text-sm text-neutral-600">
            Reply <strong>HELP</strong> to any message for assistance.
          </p>
        </section>

        <section className="bg-white rounded-xl border border-neutral-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">🚀 Try the demo</h2>
          <p className="mb-2">
            <a href="/demo" className="text-blue-600 underline">
              Start a live demo
            </a>
          </p>
          <p className="text-sm text-neutral-600">
            See how the AI receptionist works in under 30 seconds.
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
