'use client';

import { Button } from '@/components/ui/Button';
import { useStartCheckout } from '@/components/pricing/useStartCheckout';

// The generic checkout CTA. Together with PlanButton (per-plan) these are the only parts of /pricing that need the session, the router
// and the onboarding context; the rest of the page is a server component, so the plans are in the HTML a crawler or a no-JS client
// receives and the session check never gates them. The checkout logic lives in useStartCheckout.
export function GetStartedButton() {
  const { start, loading, status } = useStartCheckout();
  return (
    <Button onClick={() => start()} disabled={loading || status === 'loading'} size="lg" className="w-full sm:w-auto sm:min-w-[220px]">
      {loading ? 'Processing...' : 'Get Started'}
    </Button>
  );
}
