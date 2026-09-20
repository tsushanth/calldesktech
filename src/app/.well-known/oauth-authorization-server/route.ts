import { NextRequest } from 'next/server';
import { json, originOf, preflight } from '@/lib/oauth';

export const OPTIONS = preflight;
export const GET = (req: NextRequest) => {
  const o = originOf(req);
  return json({
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  });
};
