'use client';

import { Suspense, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOnboarding } from '@/context/OnboardingContext';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import Link from 'next/link';
import { PRICING_TIERS, ADD_ONS, CARRIER_NOTE } from '@/lib/pricingTiers';

export default function PricingPage() {
  return (
    <Suspense fallback={<main className="min-h-[60vh] bg-white flex items-center justify-center"><LoadingSpinner size="lg" /></main>}>
      <PricingPageContent />
    </Suspense>
  );
}

function PricingPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Real bug this fixes: calldesk_business_id is set ONCE during the very
  // first signup and never updated when a user switches workspaces via
  // WorkspaceSwitcher — but this page used to read ONLY that stale key, with
  // no idea which workspace was actually active. A user on their second
  // "somecompany"-named workspace clicking "Add billing" from the Numbers
  // page silently activated a Stripe subscription on their FIRST workspace
  // instead, leaving the one they were actually looking at billing-less
  // forever (and vice versa for anything gated on billing, like buying a
  // number). Priority now: an explicit ?tenantId= (how Numbers' "Add
  // billing" link reaches this page) > the actively-selected workspace from
  // context > the legacy localStorage key, kept only as a last resort for
  // the genuine first-time signup path where no tenant exists yet.
  const { tenantId: activeTenantId } = useOnboarding();
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    if (status !== 'authenticated') {
      // Redirect to sign in, then come back
      signIn('google', { callbackUrl: '/pricing' });
      return;
    }

    const businessId = searchParams.get('tenantId') || activeTenantId || localStorage.getItem('calldesk_business_id');

    if (!businessId) {
      // No business yet - go to business setup first
      // Mark that user came from pricing (wants to subscribe)
      localStorage.setItem('calldesk_flow', 'subscribe');
      router.push('/onboarding/business');
      return;
    }

    // Business exists, proceed to checkout
    setLoading(true);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });

      const data = await response.json();

      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading') {
    return (
      <main className="min-h-[60vh] bg-white flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  return (
    <main className="bg-white py-14 px-4 md:py-20">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">
            Three plans. Pay by the minute.
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-[1.5] text-gray-500">
            No monthly minimum. Pick the plan that fits your calls and pay only for talk time.
          </p>
        </div>

        {/* Tiers */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3" data-testid="pricing-tiers">
          {PRICING_TIERS.map((t) => {
            const soon = t.availability === 'coming_soon';
            return (
              <section
                key={t.id}
                aria-labelledby={`plan-${t.id}`}
                className={`flex min-w-0 flex-col rounded-2xl border p-7 ${soon ? 'border-gray-200 bg-gray-50' : t.id === 'standard' ? 'border-[#00122e] bg-white' : 'border-[#e4e4f0] bg-white'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 id={`plan-${t.id}`} className="text-2xl font-semibold tracking-[-0.03em] text-[#00122e]">{t.name}</h2>
                  {soon && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-700">Coming soon</span>}
                </div>
                <p className="mt-4 text-[#00122e]">
                  <span className="text-5xl font-normal tracking-[-0.05em]">${(t.pricePerMinuteCents / 100).toFixed(2)}</span>
                  <span className="text-gray-500"> per minute</span>
                </p>
                <p className="mt-1 text-[13px] text-gray-500">{t.carrierMode === 'byo' ? 'Phone carrier billed separately*' : 'Phone numbers and calling included'}</p>
                <p className="mt-4 text-[15px] leading-[1.5] text-gray-700">{t.tagline}</p>
                <p className="mt-2 text-[13px] leading-[1.5] text-gray-500">{t.whoItsFor}</p>
                <ul className="mt-5 space-y-3">
                  {t.includes.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[14px] leading-[1.45] text-gray-700">
                      <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                {soon && <p className="mt-auto pt-5 text-[13px] font-medium text-gray-500">Not available to start yet.</p>}
              </section>
            );
          })}
        </div>

        <p className="mx-auto mt-5 max-w-3xl text-center text-[13px] leading-[1.5] text-gray-500">*{CARRIER_NOTE}</p>

        {/* Add-ons */}
        <section aria-labelledby="addons-heading" className="mx-auto mt-14 max-w-3xl">
          <h2 id="addons-heading" className="text-[24px] font-semibold tracking-[-0.02em] text-[#00122e]">Optional add-ons</h2>
          <p className="mt-2 text-[14px] leading-[1.5] text-gray-500">Included on every plan: call summary, transcript and structured field extraction. These are extra and always your choice.</p>
          <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {ADD_ONS.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-[#00122e]">{a.label}{!a.defaultOn && <span className="ml-2 text-[12px] font-normal text-gray-400">off by default</span>}</p>
                  <p className="mt-0.5 text-[13px] leading-[1.45] text-gray-500">{a.description}</p>
                </div>
                <p className="flex-none text-[13px] text-gray-500">{a.centsPerMinute === null ? 'Price to be announced' : `+$${(a.centsPerMinute / 100).toFixed(3)} per minute`}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Get started: unchanged checkout */}
        <div className="mt-12 flex flex-col items-center gap-3">
          <Button onClick={handleSubscribe} disabled={loading} size="lg" className="w-full sm:w-auto sm:min-w-[220px]">
            {loading ? 'Processing...' : 'Get Started'}
          </Button>
          <p className="max-w-xl text-center text-[13px] text-gray-400">
            No monthly minimum. Cancel anytime. Already a customer? Your current per-minute price does not change.
          </p>
        </div>

        {/* Try Demo Link */}
        <div className="text-center mt-12">
          <p className="text-gray-500 mb-2">Want to try before you buy?</p>
          <Link
            href="/demo"
            className="text-[#00122e] font-medium underline underline-offset-4 hover:text-blue-600"
          >
            Try a free demo call
          </Link>
        </div>

      </div>
    </main>
  );
}
