import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase';
import type Stripe from 'stripe';

// A real Twilio/Retell number purchase costs money (purchase + monthly
// rental) — gate it on the tenant actually having a payment method, mirroring
// Retell's own model (build/test for free, add billing before buying a
// number). Same card-lookup logic as the billing page
// (tenants/[id]/billing/route.ts:169-185), just reusable and answering
// "can they buy" rather than rendering a card for display.
export type PaymentMethodGateResult =
  | { ok: true }
  | { ok: false; reason: 'no_stripe_customer'; action: 'checkout' }
  | { ok: false; reason: 'no_payment_method'; action: 'billing_portal' };

export async function checkPaymentMethodOnFile(tenantId: string): Promise<PaymentMethodGateResult> {
  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase
    .from('calldesk_businesses')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .single();

  const customerId = business?.stripe_customer_id;
  if (!customerId) {
    return { ok: false, reason: 'no_stripe_customer', action: 'checkout' };
  }

  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  });

  let card: Stripe.PaymentMethod.Card | null = null;
  if (customer && !customer.deleted) {
    const defaultPm = customer.invoice_settings?.default_payment_method;
    if (defaultPm && typeof defaultPm === 'object' && defaultPm.card) {
      card = defaultPm.card;
    }
  }
  if (!card) {
    const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
    card = methods.data[0]?.card ?? null;
  }

  if (!card) {
    return { ok: false, reason: 'no_payment_method', action: 'billing_portal' };
  }
  return { ok: true };
}
