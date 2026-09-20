import type { Metadata } from 'next';
import { LegalPage } from '@/components/landing/Legal';

export const metadata: Metadata = { title: 'Terms of service | CallDeskTech' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="September 20, 2026">
      <section>
        <h2>Agreement</h2>
        <p>By creating an account or using CallDeskTech you agree to these terms. If you use it for a business, you confirm you can bind that business.</p>
      </section>
      <section>
        <h2>The service</h2>
        <p>CallDeskTech lets you build AI voice agents and connect them to phone numbers. AI agents can make mistakes, mishear, or say something inaccurate. You are responsible for reviewing your agent’s behavior and for anything it says or does on your behalf, including bookings, transfers and messages.</p>
      </section>
      <section>
        <h2>Your responsibilities</h2>
        <ul>
          <li>Tell callers they are speaking with an AI agent, and get any consent required to record or transcribe calls where you operate.</li>
          <li>Follow telephone, marketing and privacy laws that apply to your calls, including rules on calling and texting people who have not agreed to hear from you.</li>
          <li>Do not use the service for fraud, harassment, emergency services, or to impersonate a person or organization.</li>
          <li>Keep your API keys and account secure. You are responsible for activity under them.</li>
        </ul>
      </section>
      <section>
        <h2>Pricing and payment</h2>
        <p>Usage is billed as shown on the <a href="/pricing">pricing page</a>: per second of call time by voice, plus small per-action fees. Charges are made to the card on file through Stripe. We may change prices for future usage with notice. Telephone numbers are billed separately.</p>
      </section>
      <section>
        <h2>Availability</h2>
        <p>We work to keep the service running, but we depend on third-party providers and cannot guarantee uninterrupted calls. Do not rely on it as your only way to receive urgent calls.</p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>You keep ownership of your instructions, knowledge base content and call data. You give us the right to process them to provide the service.</p>
      </section>
      <section>
        <h2>Suspension and ending</h2>
        <p>You can stop using the service at any time. We may suspend accounts that break these terms or put the service at risk.</p>
      </section>
      <section>
        <h2>Liability</h2>
        <p>The service is provided as is. To the extent the law allows, our total liability for any claim is limited to the amount you paid us in the three months before it, and we are not liable for lost revenue, missed calls, or indirect damages.</p>
      </section>
      <section>
        <h2>Partner program</h2>
        <p>Partners are also bound by the terms on the <a href="/partners">partners page</a>.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions: <a href="mailto:legal@calldesk.tech">legal@calldesk.tech</a>.</p>
      </section>
    </LegalPage>
  );
}
