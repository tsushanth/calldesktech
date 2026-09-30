'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// Creating a workspace needs a signed-in user, so the business demo sends
// visitors to Google sign-in first and brings them back to the start of it,
// instead of letting them fill in the form and fail with "Unauthorized".
export const DEMO_SIGN_IN_URL = `/auth/signin?callbackUrl=${encodeURIComponent('/demo/focused')}`;

export function RequireSignIn({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(DEMO_SIGN_IN_URL);
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Checking sign-in">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  return <>{children}</>;
}
