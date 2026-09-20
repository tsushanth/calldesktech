import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 32) => b64url(randomBytes(n));

export function pkceMatches(verifier: string, challenge: string) {
  return b64url(createHash('sha256').update(verifier).digest()) === challenge;
}

export function originOf(req: Request | NextRequest): string {
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'calldesk.tech';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`.replace(/\/$/, '');
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...extra } });

export function validRedirectUri(u: string) {
  try {
    const url = new URL(u);
    if (['javascript:', 'data:', 'file:', 'vbscript:'].includes(url.protocol)) return false;
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
    return true;
  } catch { return false; }
}
