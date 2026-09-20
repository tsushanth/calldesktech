import type { Metadata } from 'next';
import { Container, Eyebrow, PrimaryButton, SecondaryButton } from '@/components/landing/primitives';

export const metadata: Metadata = {
  title: 'Partner program | CallDeskTech',
  description: 'Agencies and consultants earn 20% of the usage revenue from every customer they bring to CallDeskTech, for 12 months.',
};

const TERMS = [
  { k: 'Share', v: '20% of usage revenue we collect from your referred customers: voice minutes and per-action fees. Subscription fees are not included.' },
  { k: 'Duration', v: '12 months from each customer’s first paid usage.' },
  { k: 'Payout', v: 'Monthly, about 30 days after the billing month closes. $50 minimum; smaller balances roll over. Paid by bank transfer or Stripe Connect.' },
  { k: 'Attribution', v: 'Your referral link or code, with a 90-day window. Customers who sign up outside your link are not attributed.' },
  { k: 'Refunds', v: 'Revenue that is refunded or charged back is deducted from the next payout.' },
  { k: 'Not eligible', v: 'Self-referrals, and usage you resell to your own clients at a markup.' },
];

const MATH = [
  { k: 'Customer pays', v: '$0.10 per minute', note: 'default voice' },
  { k: 'You earn', v: '$0.02 per minute', note: '20% for 12 months' },
  { k: '1,000 minutes a month', v: '$20 a month', note: 'per customer' },
];

export default function PartnersPage() {
  return (
    <main>
      <Container className="pt-16 pb-10 md:pt-24">
        <Eyebrow>Partner program</Eyebrow>
        <h1 className="mt-4 max-w-[760px] text-[40px] font-normal leading-[1.02] tracking-[-0.05em] text-[#00122e] md:text-[64px]">Build voice agents for your clients. Earn on every minute.</h1>
        <p className="mt-6 max-w-[560px] text-[17px] leading-[1.5] text-gray-500">You set up agents from our templates, your clients pay us for the calls, and you receive 20% of that usage revenue for a year.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <PrimaryButton href="mailto:partners@calldesk.tech?subject=Partner%20application" size="lg">Apply to partner</PrimaryButton>
          <SecondaryButton href="/pricing" size="lg">See pricing</SecondaryButton>
        </div>
      </Container>

      <Container className="py-10">
        <dl className="grid gap-4 md:grid-cols-3">
          {MATH.map((m) => (
            <div key={m.k} className="rounded-xl border border-gray-200 p-6">
              <dt className="text-[13px] text-gray-500">{m.k}</dt>
              <dd className="mt-2 text-[30px] tracking-[-0.04em] text-[#00122e]">{m.v}</dd>
              <p className="mt-1 text-[13px] text-gray-400">{m.note}</p>
            </div>
          ))}
        </dl>
      </Container>

      <Container className="py-10">
        <h2 className="text-[28px] font-normal tracking-[-0.04em] text-[#00122e]">Terms</h2>
        <dl className="mt-6 divide-y divide-gray-200 border-y border-gray-200">
          {TERMS.map((t) => (
            <div key={t.k} className="grid gap-2 py-5 md:grid-cols-[200px_1fr]">
              <dt className="text-[15px] font-medium text-[#00122e]">{t.k}</dt>
              <dd className="text-[15px] leading-[1.55] text-gray-600">{t.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-[640px] text-[13px] leading-[1.5] text-gray-400">Rates above are for the default voice. Premium voices are priced higher, and the share applies to what the customer is actually charged. Terms may change for new referrals with 30 days notice.</p>
      </Container>

      <Container className="py-10">
        <h2 className="text-[28px] font-normal tracking-[-0.04em] text-[#00122e]">How it works</h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          <li><p className="text-[15px] font-medium text-[#00122e]">Apply</p><p className="mt-2 text-[15px] leading-[1.55] text-gray-600">Email us with your agency name and the kinds of businesses you serve. We reply with your referral link.</p></li>
          <li><p className="text-[15px] font-medium text-[#00122e]">Build</p><p className="mt-2 text-[15px] leading-[1.55] text-gray-600">Start from a template, or create agents through the API or MCP server, and set them up for your client’s business.</p></li>
          <li><p className="text-[15px] font-medium text-[#00122e]">Get paid</p><p className="mt-2 text-[15px] leading-[1.55] text-gray-600">Each month we send a statement of attributed usage and pay out the balance.</p></li>
        </ol>
      </Container>
    </main>
  );
}
