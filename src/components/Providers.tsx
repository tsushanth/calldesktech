'use client';

import { SessionProvider } from 'next-auth/react';
import { Analytics } from '@/components/Analytics';
import { OnboardingProvider } from '@/context/OnboardingContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Analytics />
      <OnboardingProvider>{children}</OnboardingProvider>
    </SessionProvider>
  );
}
