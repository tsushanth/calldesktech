'use client';

import { Suspense, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOnboarding } from '@/context/OnboardingContext';
import { PricingCard } from '@/components/onboarding/PricingCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import Link from 'next/link';
import { PRICING } from '@/lib/constants';

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
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">
            Simple, usage-based pricing.
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-[1.5] text-gray-500">
            No monthly minimum. Pay only for talk time and completed actions.
          </p>
        </div>

        {/* Pricing Card */}
        <div className="flex justify-center mb-8">
          <PricingCard onSubscribe={handleSubscribe} loading={loading} />
        </div>

        {/* vs. Retell — the default-voice number is our own priced rate
            (USAGE_PRICES/PRICING in src/lib/constants.ts); the Retell figure
            is real observed blended cost-per-minute from an actual Retell
            account's own billing dashboard (voice infra + LLM + phone +
            telephony + TTS combined), not a published Retell price sheet —
            worded that way deliberately so this stays honest if Retell's
            own pricing changes. */}
        <div className="max-w-2xl mx-auto mb-12 rounded-2xl bg-[#f4f4fa] p-6 md:p-8">
          <h3 className="text-center text-[15px] font-semibold text-[#1a1d29] mb-1">How this compares</h3>
          <p className="text-center text-[12.5px] text-gray-400 mb-5">
            Retell figure is real observed blended cost-per-minute from an actual account&apos;s own billing dashboard, not a published price sheet.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-[#00122e] p-4 text-center">
              <p className="text-[12px] font-medium text-white/70 mb-1">This platform (default voice)</p>
              <p className="text-[28px] font-semibold tracking-[-0.03em] text-white">${PRICING.usage.voicePerMinute.kokoro.toFixed(2)}</p>
              <p className="text-[12px] text-white/70">per minute</p>
            </div>
            <div className="rounded-xl bg-white p-4 text-center">
              <p className="text-[12px] font-medium text-gray-500 mb-1">Retell (observed blended avg)</p>
              <p className="text-[28px] font-semibold tracking-[-0.03em] text-gray-700">~$0.16</p>
              <p className="text-[12px] text-gray-500">per minute</p>
            </div>
          </div>
          <p className="mt-4 text-center text-[12px] text-gray-400">
            Premium voices (ElevenLabs, Cartesia, MiniMax) run ${PRICING.usage.voicePerMinute.elevenlabs.toFixed(2)}–${PRICING.usage.voicePerMinute.minimax.toFixed(2)}/min here — still no monthly minimum either way.
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
