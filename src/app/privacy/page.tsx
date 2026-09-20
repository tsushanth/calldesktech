import type { Metadata } from 'next';
import { LegalPage } from '@/components/landing/Legal';

export const metadata: Metadata = { title: 'Privacy policy | CallDeskTech' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="September 20, 2026">
      <section>
        <h2>What this covers</h2>
        <p>CallDeskTech provides AI voice agents that answer phone calls for businesses. This policy explains what we collect, why, and who else handles it. There are two groups of people: our customers (businesses who set up agents) and callers (people who phone those agents).</p>
      </section>
      <section>
        <h2>What we collect</h2>
        <ul>
          <li><strong>Account data</strong> from customers: name, email address (through Google sign-in), business details, and billing information handled by Stripe. We do not store card numbers.</li>
          <li><strong>Call data</strong>: the caller’s phone number, the time and length of the call, a transcript, details the agent collected during the call (such as a name or a booking time), and a call summary. Audio recordings are made only when the customer turns recording on.</li>
          <li><strong>Configuration</strong>: agent instructions, knowledge base content, and connected tools a customer sets up.</li>
        </ul>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>To run the agent and connect calls, to show customers their call history, to bill usage, to keep the service secure, and to fix problems. We do not sell personal information.</p>
      </section>
      <section>
        <h2>Who handles data on our behalf</h2>
        <p>Our service depends on these providers, each of which processes some data only to provide its function:</p>
        <ul>
          <li>Twilio (telephone calls and text messages)</li>
          <li>Deepgram (speech to text)</li>
          <li>Anthropic (the language model that writes the agent’s replies)</li>
          <li>Modal and, when selected, ElevenLabs, Cartesia or MiniMax (text to speech)</li>
          <li>Supabase and Fly.io (database and hosting)</li>
          <li>Stripe (payments) and Google (sign-in)</li>
          <li>Cal.com and any other tool a customer chooses to connect</li>
        </ul>
      </section>
      <section>
        <h2>Callers and recording</h2>
        <p>Customers are responsible for telling callers that the call is handled by an AI agent and, where the law requires it, that it may be recorded or transcribed, and for getting any consent needed. Our agents can be configured to say this at the start of a call.</p>
      </section>
      <section>
        <h2>Retention and deletion</h2>
        <p>Customers can delete calls and agents from their dashboard. We keep account and call data while the account is active. To request deletion of an account, or of a caller’s data, email us and we will act on it within 30 days, except for records we must keep for billing or legal reasons.</p>
      </section>
      <section>
        <h2>Your rights</h2>
        <p>Depending on where you live, you may have the right to access, correct, delete, or export your personal information, or to object to how it is used. Callers who want their data removed should contact the business they called; they can also email us and we will pass the request on.</p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>If we change this policy in a way that matters, we will update the date above and, for customers, notify them by email. Questions: <a href="mailto:privacy@calldesk.tech">privacy@calldesk.tech</a>.</p>
      </section>
    </LegalPage>
  );
}
