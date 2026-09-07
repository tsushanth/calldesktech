import { NextRequest, NextResponse } from 'next/server';
import { encode } from 'next-auth/jwt';

// TEMPORARY debug-only route — mints a real NextAuth session cookie for a
// given user id, gated behind NEXTAUTH_SECRET itself as the query param (so
// only someone who already has that secret can use it). Used once to drive
// an authenticated end-to-end Playwright pass against production, then
// deleted. Never merge/deploy this to a long-lived branch.
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  const userId = request.nextUrl.searchParams.get('userId');
  if (!secret || secret !== process.env.NEXTAUTH_SECRET || !userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const token = await encode({
    token: { sub: userId, name: 'Debug Session', email: 'debug@local' },
    secret: process.env.NEXTAUTH_SECRET!,
  });

  const res = NextResponse.redirect(new URL('/dashboard', process.env.NEXT_PUBLIC_APP_URL || request.url));
  res.cookies.set('__Secure-next-auth.session-token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  res.cookies.set('next-auth.session-token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
