import { NextRequest } from 'next/server';
import { CORS, json, originOf, preflight } from '@/lib/oauth';

export const OPTIONS = preflight;
export const GET = (req: NextRequest) => {
  const o = originOf(req);
  return json({ resource: `${o}/mcp`, authorization_servers: [o], bearer_methods_supported: ['header'], scopes_supported: ['mcp'], resource_name: 'CallDeskTech' }, 200, { ...CORS });
};
