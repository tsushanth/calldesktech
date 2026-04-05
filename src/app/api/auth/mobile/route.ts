import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { signMobileToken } from '@/lib/mobile-auth';
import jwt from 'jsonwebtoken';

interface AppleJWTPayload {
  iss: string;
  sub: string; // Apple user ID
  aud: string;
  email?: string;
  email_verified?: string | boolean;
}

interface GoogleTokenPayload {
  sub: string; // Google user ID
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

/**
 * POST /api/auth/mobile
 *
 * Authenticates mobile users via Apple or Google ID tokens.
 * Returns a signed JWT for subsequent API calls.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, id_token, name } = body;

    if (!provider || !id_token) {
      return NextResponse.json(
        { error: 'provider and id_token are required' },
        { status: 400 }
      );
    }

    if (!['apple', 'google'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "apple" or "google".' },
        { status: 400 }
      );
    }

    let userId: string;
    let email: string;
    let userName: string | null = name || null;

    if (provider === 'apple') {
      const appleUser = await verifyAppleToken(id_token);
      if (!appleUser) {
        return NextResponse.json(
          { error: 'Invalid Apple ID token' },
          { status: 401 }
        );
      }
      userId = `apple_${appleUser.sub}`;
      email = appleUser.email || '';
    } else {
      const googleUser = await verifyGoogleToken(id_token);
      if (!googleUser) {
        return NextResponse.json(
          { error: 'Invalid Google ID token' },
          { status: 401 }
        );
      }
      userId = googleUser.sub;
      email = googleUser.email;
      userName = userName || googleUser.name || null;
    }

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required. Please grant email permission.' },
        { status: 400 }
      );
    }

    // Upsert user in Supabase (same pattern as NextAuth callback in auth.ts)
    const supabase = getSupabaseAdmin();
    const { error: upsertError } = await supabase.from('users').upsert(
      {
        id: userId,
        email,
        name: userName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (upsertError) {
      console.error('Failed to sync user to Supabase:', upsertError);
      // Continue anyway — allow auth even if sync fails
    }

    // Check if user has an existing tenant
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name, phone_number, settings')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    const tenant = tenants?.[0] || null;

    // Sign JWT
    const token = signMobileToken(userId, email);

    return NextResponse.json({
      token,
      user: {
        id: userId,
        email,
        name: userName,
      },
      tenant_id: tenant?.id || null,
      has_business: !!tenant,
      is_activated: tenant?.settings?.subscription_status === 'active' && !!tenant?.phone_number,
    });
  } catch (error) {
    console.error('Mobile auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

/**
 * Verify an Apple ID token by fetching Apple's JWKS and validating the JWT.
 */
async function verifyAppleToken(idToken: string): Promise<AppleJWTPayload | null> {
  try {
    // Fetch Apple's public keys
    const response = await fetch('https://appleid.apple.com/auth/keys');
    if (!response.ok) {
      console.error('Failed to fetch Apple JWKS');
      return null;
    }

    const jwks = await response.json();

    // Decode the token header to find the key ID
    const header = JSON.parse(
      Buffer.from(idToken.split('.')[0], 'base64url').toString()
    );

    const key = jwks.keys.find((k: { kid: string }) => k.kid === header.kid);
    if (!key) {
      console.error('Apple signing key not found');
      return null;
    }

    // Convert JWK to PEM for verification
    const pem = await jwkToPem(key);

    const payload = jwt.verify(idToken, pem, {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
    }) as AppleJWTPayload;

    return payload;
  } catch (error) {
    console.error('Apple token verification failed:', error);
    return null;
  }
}

/**
 * Verify a Google ID token using Google's tokeninfo endpoint.
 */
async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );

    if (!response.ok) {
      console.error('Google token verification failed');
      return null;
    }

    const payload = await response.json();

    // Verify the audience matches our Google client ID
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && payload.aud !== clientId) {
      // Also accept iOS client ID if configured
      const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID;
      if (!iosClientId || payload.aud !== iosClientId) {
        console.error('Google token audience mismatch');
        return null;
      }
    }

    return {
      sub: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified === 'true',
      name: payload.name,
      picture: payload.picture,
    };
  } catch (error) {
    console.error('Google token verification error:', error);
    return null;
  }
}

/**
 * Convert a JWK (JSON Web Key) to PEM format for JWT verification.
 */
async function jwkToPem(jwk: { n: string; e: string; kty: string }): Promise<string> {
  const keyData = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify']
  );
  const exported = await crypto.subtle.exportKey('spki', keyData);
  const base64 = Buffer.from(exported).toString('base64');
  const lines = base64.match(/.{1,64}/g)!;
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}
