// UTM tagging for every link in an outreach email (sample link, site link, deck link), so PostHog and the
// sample/deck pages can attribute a visit to the campaign and the touch that produced it.
//
//   utm_source=outreach  utm_medium=email  utm_campaign=<vertical id>  utm_content=step<N>
//
// No personal data goes in the query string: the links already carry the signed per-message token `t`
// (an opaque HMAC of the message id, never an email address) and that is the only per-recipient
// identifier; utm_term is therefore not set unless a caller passes a non-personal token explicitly.
// The unsubscribe link is deliberately NOT tagged (it must stay exactly as built by unsubscribe.ts).

export interface UtmContext {
  /** Vertical id, e.g. 'freight'. Use campaignFor(product) to derive it. */
  campaign: string;
  /** Touch number: 1 = first email, 2 = first follow-up, ... */
  step: number;
  /** Optional non-personal token. Never an email address. */
  term?: string | null;
}

/** 'calldesk:freight' -> 'freight', 'calldesk' -> 'calldesk', 'readaloud:api' -> 'readaloud', 'kreativekoala:voxkey' -> 'voxkey'. */
export function campaignFor(product: string | null | undefined): string {
  const p = (product || 'calldesk').trim().toLowerCase();
  if (p.startsWith('readaloud')) return 'readaloud';
  const slug = p.includes(':') ? p.split(':')[1] : p;
  return slug.replace(/[^a-z0-9_-]/g, '') || 'calldesk';
}

/** Returns `url` with the UTM params set (existing params such as the `t` token are kept). Unparseable input is returned unchanged. */
export function withUtm(url: string, ctx: UtmContext): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
  const step = Number.isFinite(ctx.step) && ctx.step >= 1 ? Math.floor(ctx.step) : 1;
  u.searchParams.set('utm_source', 'outreach');
  u.searchParams.set('utm_medium', 'email');
  u.searchParams.set('utm_campaign', ctx.campaign);
  u.searchParams.set('utm_content', `step${step}`);
  if (ctx.term && !ctx.term.includes('@')) u.searchParams.set('utm_term', ctx.term);
  else u.searchParams.delete('utm_term');
  return u.toString();
}
