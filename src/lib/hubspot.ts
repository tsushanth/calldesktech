// HubSpot CRM integration — this app is an OAuth CLIENT against HubSpot.
// Endpoints/params verified 2026-09-21 against developers.hubspot.com
// (OAuth quickstart guide + CRM Contacts/Calls API references):
//   authorize: https://app.hubspot.com/oauth/authorize
//   token:     https://api.hubapi.com/oauth/v1/token
//   contacts:  https://api.hubapi.com/crm/v3/objects/contacts (+ /search)
//   calls:     https://api.hubapi.com/crm/v3/objects/calls
//
// Mirrors the RetellClient wrapper shape in src/lib/retell.ts: a thin class
// around fetch, one typed error, one method per operation actually used.
//
// Salesforce is documented-only, not built — see src/lib/salesforce.ts.

const HUBSPOT_AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize';
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const HUBSPOT_API_URL = 'https://api.hubapi.com';

// Scopes the connected app is actually permitted to grant. `oauth` is HubSpot's base scope,
// always implicitly required. crm.objects.calls.read/write (would let us log calls as HubSpot
// Call activities, not just sync Contacts) are NOT included here — real, current limitation:
// this app's portal plan doesn't grant that scope without a HubSpot support request. Requesting
// a scope the app isn't permitted to grant fails the OAuth authorize step outright, so don't
// re-add these until that access is actually approved (see docs/hubspot-app-setup or the parity
// scorecard for the real status).
export const HUBSPOT_SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
] as const;

export class HubSpotApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`HubSpot API Error: ${status} - ${body}`);
    this.name = 'HubSpotApiError';
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

/** Builds the URL to send a user to for the HubSpot "Connect" button. `state`
 * should be an opaque value we can verify on callback (see the connect route,
 * which signs `${tenantId}.${nonce}` the same way webhooks sign payloads). */
export function buildHubSpotAuthorizeUrl(redirectUri: string, state: string): string {
  const clientId = requireEnv('HUBSPOT_CLIENT_ID');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: HUBSPOT_SCOPES.join(' '),
    state,
  });
  return `${HUBSPOT_AUTHORIZE_URL}?${params.toString()}`;
}

export interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds; HubSpot access tokens currently last 30 min
  token_type: string;
}

/** Never logs `code`, the client secret, or the response body — those are
 * effectively bearer credentials even though they're short-lived. */
export async function exchangeHubSpotCode(
  code: string,
  redirectUri: string
): Promise<HubSpotTokenResponse> {
  const clientId = requireEnv('HUBSPOT_CLIENT_ID');
  const clientSecret = requireEnv('HUBSPOT_CLIENT_SECRET');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    // Body may echo the auth code back; still don't log it verbatim.
    throw new HubSpotApiError(res.status, '[token exchange failed]');
  }
  return res.json();
}

export async function refreshHubSpotToken(refreshToken: string): Promise<HubSpotTokenResponse> {
  const clientId = requireEnv('HUBSPOT_CLIENT_ID');
  const clientSecret = requireEnv('HUBSPOT_CLIENT_SECRET');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new HubSpotApiError(res.status, '[token refresh failed]');
  return res.json();
}

export interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
}

// Standard HubSpot-defined association type id for "call to contact"
// (verified against the CRM Calls API reference's sample request).
const CALL_TO_CONTACT_ASSOCIATION_TYPE_ID = 194;

class HubSpotClient {
  constructor(private accessToken: string) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${HUBSPOT_API_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new HubSpotApiError(res.status, errBody);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  /** CRM→us lookup: find a contact by phone for personalization variables. */
  async findContactByPhone(phone: string): Promise<HubSpotContact | null> {
    const result = await this.request<{ results: HubSpotContact[] }>(
      '/crm/v3/objects/contacts/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }] },
          ],
          properties: ['firstname', 'lastname', 'email', 'company', 'phone', 'jobtitle'],
          limit: 1,
        }),
      }
    );
    return result.results[0] ?? null;
  }

  /** us→CRM upsert by phone: update if found, else create. */
  async upsertContactByPhone(
    phone: string,
    properties: Record<string, string>
  ): Promise<HubSpotContact> {
    const existing = await this.findContactByPhone(phone);
    if (existing) {
      return this.request<HubSpotContact>(`/crm/v3/objects/contacts/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
    }
    return this.request<HubSpotContact>('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties: { phone, ...properties } }),
    });
  }

  /** us→CRM activity log: record the call as a Call engagement, associated
   * with the given contact. */
  async logCall(params: {
    contactId: string;
    title: string;
    body: string;
    durationMs: number;
    direction: 'INBOUND' | 'OUTBOUND';
    timestamp: string; // ISO
    status?: string;
  }): Promise<{ id: string }> {
    return this.request('/crm/v3/objects/calls', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          hs_timestamp: params.timestamp,
          hs_call_title: params.title,
          hs_call_body: params.body,
          hs_call_duration: String(params.durationMs),
          hs_call_direction: params.direction,
          hs_call_status: params.status ?? 'COMPLETED',
        },
        associations: [
          {
            to: { id: Number(params.contactId) },
            types: [
              { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: CALL_TO_CONTACT_ASSOCIATION_TYPE_ID },
            ],
          },
        ],
      }),
    });
  }
}

export function hubspotClient(accessToken: string): HubSpotClient {
  return new HubSpotClient(accessToken);
}
