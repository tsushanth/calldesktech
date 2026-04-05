import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

interface MobileUser {
  id: string;
  email: string;
}

/**
 * Extract and verify a mobile JWT Bearer token from the request.
 * Returns the user info if valid, null otherwise.
 * Used alongside getServerSession() for dual auth support.
 */
export async function getMobileUser(request: NextRequest): Promise<MobileUser | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const secret = process.env.NEXTAUTH_SECRET;

  if (!secret) {
    console.error('NEXTAUTH_SECRET is not configured');
    return null;
  }

  try {
    const payload = jwt.verify(token, secret) as { sub: string; email: string };
    if (!payload.sub || !payload.email) return null;
    return { id: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Sign a JWT for mobile auth.
 * Uses the same secret as NextAuth for consistency.
 */
export function signMobileToken(userId: string, email: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not configured');

  return jwt.sign(
    { sub: userId, email },
    secret,
    { expiresIn: '30d' }
  );
}
