'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/context/OnboardingContext';
import { Button } from '@/components/ui/Button';

// The only part of /pricing that needs the session, the router and the onboarding context. The rest of the page is a server component, so
// the plans are in the HTML a crawler or a no-JS client receives and the session check never gates them. The ?tenantId= query param is read
// from window.location at click time (instead of useSearchParams) so this island does not need a Suspense boundary, which would
// force the page to client-render its fallback.
export function GetStartedButton() {
  const { status } = useSession();
  const router = useRouter();
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

    const businessId = new URLSearchParams(window.location.search).get('tenantId') || activeTenantId || localStorage.getItem('calldesk_business_id');

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

  return (
    <Button onClick={handleSubscribe} disabled={loading || status === 'loading'} size="lg" className="w-full sm:w-auto sm:min-w-[220px]">
      {loading ? 'Processing...' : 'Get Started'}
    </Button>
  );
}
