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

        <p className="max-w-2xl mx-auto mb-12 text-center text-[13px] text-gray-400">
          Default voice: ${PRICING.usage.voicePerMinute.kokoro.toFixed(2)}/min. Premium voices (ElevenLabs, Cartesia, MiniMax) run ${PRICING.usage.voicePerMinute.elevenlabs.toFixed(2)}&ndash;${PRICING.usage.voicePerMinute.minimax.toFixed(2)}/min. No monthly minimum.
        </p>

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
