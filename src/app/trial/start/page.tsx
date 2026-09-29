import { redirect } from 'next/navigation';

// Trials are no longer explained on their own page -- /demo is the front
// door now. This exists only to catch old/external links to /trial/start.
export default function TrialStartPage() {
  redirect('/demo');
}
