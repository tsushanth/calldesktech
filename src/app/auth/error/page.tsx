'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    OAuthSignin: 'Error signing in with Google. Please try again.',
    OAuthCallback: 'Error during authentication callback. Please try again.',
    OAuthCreateAccount: 'Could not create account. Please try again.',
    OAuthAccountNotLinked: 'This email is already associated with another account.',
    EmailCreateAccount: 'Could not create account with this email.',
    Callback: 'Authentication callback error. Please try again.',
    Default: 'An unexpected error occurred. Please try again.',
  };

  const errorMessage = errorMessages[error || 'Default'] || errorMessages.Default;

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        {/* Error Icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
          <svg
            className="w-8 h-8 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Authentication Error</h1>
        <p className="text-gray-600 mb-6">{errorMessage}</p>

        <div className="space-y-3">
          <Link href="/auth/signin">
            <Button className="w-full">Try Again</Button>
          </Link>
          <Link href="/">
            <Button variant="secondary" className="w-full">
              Back to Home
            </Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center p-8">
            <LoadingSpinner size="lg" />
          </Card>
        </main>
      }
    >
      <ErrorContent />
    </Suspense>
  );
}
