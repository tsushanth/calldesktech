'use client';

import { Button } from '@/components/ui/Button';
import { useStartCheckout } from '@/components/pricing/useStartCheckout';
import { storePlan } from '@/lib/planSelection';
import { tierById, type TierId } from '@/lib/pricingTiers';

// "Start with <Plan>": remembers the plan (the builder preselects it later), then runs the same sign-in / onboarding / checkout flow as
// the generic button. Checkout billing itself is unchanged by the plan.
export function PlanButton({ plan }: { plan: TierId }) {
  const { start, loading, status } = useStartCheckout();
  const name = tierById(plan)?.name ?? plan;
  return (
    <Button
      onClick={() => { storePlan(plan); void start({ callbackUrl: `/pricing?plan=${plan}` }); }}
      disabled={loading || status === 'loading'}
      variant={plan === 'standard' ? 'primary' : 'secondary'}
      size="md"
      className="w-full"
      data-plan={plan}
    >
      {loading ? 'Processing...' : `Start with ${name}`}
    </Button>
  );
}
