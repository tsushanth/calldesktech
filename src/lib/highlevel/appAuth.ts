import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

// HighLevel calls our action and trigger endpoints with a shared secret that we configure in the Marketplace app, so
// nobody else can make us place calls or subscribe call events to a URL. The secret goes in a custom header; the query
// string (?k=) is accepted too, for any HighLevel setting that cannot send a header (the trigger Subscription URL).
// HIGHLEVEL_APP_SECRET: a long random string, not the OAuth client secret.

export const APP_SECRET_HEADER = 'x-calldesk-secret';

/** null when the request carries the secret, otherwise the response to return. */
export function requireAppSecret(req: NextRequest, env: Record<string, string | undefined> = process.env): NextResponse | null {
  const expected = env.HIGHLEVEL_APP_SECRET;
  if (!expected || expected.length < 16) return NextResponse.json({ error: 'The HighLevel app is not configured' }, { status: 503 });
  const given = Buffer.from(req.headers.get(APP_SECRET_HEADER) ?? req.nextUrl.searchParams.get('k') ?? '');
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}
