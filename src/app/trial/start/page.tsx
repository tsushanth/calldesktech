import { redirect } from 'next/navigation';

// Trials are SMS-only (see src/app/api/webhooks/trial-sms/route.ts). This
// route exists only to catch old/external links to /trial/start and send
// them to the real explainer page at /trial.
export default function TrialStartRedirect() {
  redirect('/trial');
}
