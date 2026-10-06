// Voice-agent platforms we must not contact about ReadAloud/TTS provider listings or as resellers until the owner decides:
// the speech-API partnership route to these companies is being handled separately (owner decision pending, 2026-10-06).
// Applies to email sends, contact forms and cold calls. Matches the registered domain and its subdomains.
export const PLATFORM_DOMAINS = [
  'vapi.ai', 'retellai.com', 'retell.ai', 'bland.ai', 'synthflow.ai', 'poly.ai', 'polyai.com', 'twilio.com',
  'livekit.io', 'livekit.com', 'pipecat.ai', 'daily.co',
];

/** True for a domain, URL or email address that belongs to one of the blocked platforms (or a subdomain of one). */
export function isPlatformDomain(input: string | null | undefined): boolean {
  if (!input) return false;
  let host = input.trim().toLowerCase();
  if (host.includes('@')) host = host.slice(host.lastIndexOf('@') + 1);
  host = host.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '');
  return PLATFORM_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}
