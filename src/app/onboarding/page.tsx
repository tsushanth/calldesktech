'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function OnboardingContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    // Check authentication
    if (status === 'unauthenticated') {
      router.push('/auth/signin?callbackUrl=/onboarding');
      return;
    }

    if (status === 'loading') return;

    // Handle post-payment redirect from Stripe
    if (sessionId) {
      // Clear old state and store session ID
      localStorage.removeItem('calldesk_onboarding_step');
      localStorage.setItem('calldesk_stripe_session_id', sessionId);

      // Check if business already exists
      const businessId = localStorage.getItem('calldesk_business_id');
      if (businessId) {
        // Business exists, go to complete
        router.push('/onboarding/complete');
      } else {
        // Need to set up business first
        router.push('/onboarding/business');
      }
      return;
    }

    // Check for existing business
    const businessId = localStorage.getItem('calldesk_business_id');
    const existingSessionId = localStorage.getItem('calldesk_stripe_session_id');

    if (businessId && existingSessionId) {
      // Has business and payment - go to complete
      router.push('/onboarding/complete');
    } else if (businessId) {
      // Has business but no payment - go to pricing
      router.push('/pricing');
    } else {
      // No business - go to pricing to start fresh
      router.push('/pricing');
    }
  }, [status, sessionId, router]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-gray-600">Setting up your account...</p>
      </Card>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-8 text-center">
            <LoadingSpinner size="lg" />
          </Card>
        </main>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
