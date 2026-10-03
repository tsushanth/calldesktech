import type { Metadata } from 'next';
import { HEADLINE, HEADLINE_WITH_QUALIFIER } from '@/lib/pricingCopy';
import { PricingContent } from '@/components/pricing/PricingContent';
import { GetStartedButton } from '@/components/pricing/GetStartedButton';

export const metadata: Metadata = {
  title: `Pricing: ${HEADLINE} | CallDeskTech`,
  description: HEADLINE_WITH_QUALIFIER,
};

// A server component: the plans, carrier note, add-ons and comparison link are in the initial HTML. Only the calculator and the checkout
// button are client islands, so a slow or failed session lookup can never blank the page.
export default function PricingPage() {
  return <PricingContent cta={<GetStartedButton />} />;
}
