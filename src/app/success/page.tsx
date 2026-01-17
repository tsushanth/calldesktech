'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function SuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    if (sessionId) {
      // Store session ID and redirect to onboarding
      localStorage.setItem('calldesk_stripe_session_id', sessionId);
      router.push(`/onboarding?session_id=${sessionId}`);
    } else {
      // No session ID, redirect to pricing
      router.push('/pricing');
    }
  }, [sessionId, router]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Payment Successful!
        </h1>
        <p className="text-gray-600 mb-6">
          Setting up your AI receptionist...
        </p>
        <LoadingSpinner size="md" />
      </Card>
    </main>
  );
}

export default function SuccessPage() {
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
      <SuccessContent />
    </Suspense>
  );
}
