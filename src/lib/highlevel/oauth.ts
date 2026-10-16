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

// oauth.readonly and oauth.write are for agency installs: HighLevel hands the app one agency-wide token, and these let it list the
// sub-accounts that were approved and turn the agency token into a token for each one.
export const HIGHLEVEL_SCOPES = ['contacts.readonly', 'contacts.write', 'workflows.readonly', 'oauth.readonly', 'oauth.write'] as const;

const API = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const MAX_LOCATIONS = 25;

export interface InstalledLocation { id: string; name: string }

async function agencyCall(path: string, companyToken: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${companyToken}`, Version: API_VERSION, Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
  let json: Record<string, unknown> = {};
  try { json = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const why = typeof json.message === 'string' ? json.message : typeof json.error === 'string' ? json.error : 'request failed';
    throw new HighLevelAuthError(res.status, `HighLevel agency request failed (${res.status}): ${why.slice(0, 160)}`);
  }
  return json;
}

/** The sub-accounts an agency approved the app for, at most 25. Needs the oauth.readonly scope. */
export async function listInstalledLocations(companyToken: string, companyId: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<InstalledLocation[]> {
  const appId = (env.HIGHLEVEL_CLIENT_ID ?? '').split('-')[0];
  if (!appId) throw new Error('HIGHLEVEL_CLIENT_ID must be set');
  const q = new URLSearchParams({ companyId, appId, isInstalled: 'true', limit: String(MAX_LOCATIONS) });
  const json = await agencyCall(`/oauth/installedLocations?${q.toString()}`, companyToken, { method: 'GET' }, fetchImpl);
  const raw = Array.isArray(json.locations) ? json.locations : [];
  return raw
    .map((l) => l as Record<string, unknown>)
    .filter((l) => typeof l._id === 'string' && l._id)
    .slice(0, MAX_LOCATIONS)
    .map((l) => ({ id: l._id as string, name: typeof l.name === 'string' && l.name ? l.name : 'Unnamed sub-account' }));
}

/** A token for one sub-account, minted from the agency token. Needs the oauth.write scope. */
export async function locationTokenFor(companyToken: string, companyId: string, locationId: string, fetchImpl: typeof fetch = fetch): Promise<HighLevelTokens> {
  const json = await agencyCall('/oauth/locationToken', companyToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ companyId, locationId }).toString(),
  }, fetchImpl);
  if (typeof json.access_token !== 'string' || typeof json.refresh_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new HighLevelAuthError(502, 'HighLevel location token response was missing access_token, refresh_token or expires_in');
  }
  return { ...(json as unknown as HighLevelTokens), locationId: typeof json.locationId === 'string' && json.locationId ? json.locationId : locationId, companyId };
}

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
