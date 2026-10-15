// OAuth 2.0 token calls for the HighLevel Marketplace app. Docs: marketplace.gohighlevel.com/docs/Authorization/OAuth2.0
//  - install: the Marketplace sends the browser to our redirect URL with ?code=; we exchange it here.
//  - access tokens last about 24 hours; the refresh token rotates on every use (the old one stops working).

type Env = Record<string, string | undefined>;

export const HIGHLEVEL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

export interface HighLevelTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  userType?: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
  scope?: string;
  isBulkInstallation?: boolean;
  approvedLocations?: string[];
}

/** The parts of a token response that are safe to log: which fields came back, who installed, and what was granted. Never a token. */
export function describeTokens(t: Partial<HighLevelTokens> & Record<string, unknown>): Record<string, unknown> {
  return {
    fields: Object.keys(t).sort(),
    userType: t.userType ?? null,
    hasCompanyId: Boolean(t.companyId),
    hasLocationId: Boolean(t.locationId),
    isBulkInstallation: t.isBulkInstallation ?? null,
    approvedLocationCount: Array.isArray(t.approvedLocations) ? t.approvedLocations.length : null,
    scope: typeof t.scope === 'string' ? t.scope : null,
    expiresIn: t.expires_in ?? null,
  };
}

/** A failed token call. `message` is safe to log: it never contains the client secret, code or tokens. */
export class HighLevelAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HighLevelAuthError';
  }
}

function config(env: Env) {
  const clientId = env.HIGHLEVEL_CLIENT_ID, clientSecret = env.HIGHLEVEL_CLIENT_SECRET, redirectUri = env.HIGHLEVEL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error('HIGHLEVEL_CLIENT_ID, HIGHLEVEL_CLIENT_SECRET and HIGHLEVEL_REDIRECT_URI must be set');
  return { clientId, clientSecret, redirectUri };
}

async function tokenRequest(grant: Record<string, string>, env: Env, fetchImpl: typeof fetch): Promise<HighLevelTokens> {
  const c = config(env);
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, user_type: 'Location', redirect_uri: c.redirectUri, ...grant });
  const res = await fetchImpl(HIGHLEVEL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  let json: Record<string, unknown> = {};
  try { json = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const why = typeof json.error_description === 'string' ? json.error_description : typeof json.message === 'string' ? json.message : typeof json.error === 'string' ? json.error : 'request failed';
    throw new HighLevelAuthError(res.status, `HighLevel token request failed (${res.status}): ${why.slice(0, 160)}`);
  }
  if (typeof json.access_token !== 'string' || typeof json.refresh_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new HighLevelAuthError(502, 'HighLevel token response was missing access_token, refresh_token or expires_in');
  }
  return json as unknown as HighLevelTokens;
}

export function exchangeCode(code: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<HighLevelTokens> {
  return tokenRequest({ grant_type: 'authorization_code', code }, env, fetchImpl);
}

export function refreshTokens(refreshToken: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<HighLevelTokens> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, env, fetchImpl);
}

export const HIGHLEVEL_SCOPES = ['contacts.readonly', 'contacts.write', 'workflows.readonly'] as const;

/**
 * The link an agency admin opens to install the app: HighLevel's "choose a location" page, which returns to our redirect URL with a code.
 * version_id (the app id, the part of the client id before the dash) is only needed while the app is a draft or private test version;
 * set HIGHLEVEL_APP_PUBLISHED=true once it is public to leave it out. Null when the app is not configured.
 */
export function installUrl(env: Env = process.env): string | null {
  const clientId = env.HIGHLEVEL_CLIENT_ID, redirectUri = env.HIGHLEVEL_REDIRECT_URI;
  if (!clientId || !redirectUri) return null;
  const q = new URLSearchParams({ response_type: 'code', redirect_uri: redirectUri, client_id: clientId, scope: HIGHLEVEL_SCOPES.join(' ') });
  if (env.HIGHLEVEL_APP_PUBLISHED !== 'true') q.set('version_id', clientId.split('-')[0]);
  return `https://marketplace.gohighlevel.com/oauth/chooselocation?${q.toString().replace(/\+/g, '%20')}`;
}
