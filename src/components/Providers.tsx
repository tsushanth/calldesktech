'use client';

import { SessionProvider } from 'next-auth/react';
import { OnboardingProvider } from '@/context/OnboardingContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <OnboardingProvider>{children}</OnboardingProvider>
    </SessionProvider>
  );
}
