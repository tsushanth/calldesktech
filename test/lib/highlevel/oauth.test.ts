import { describe, it, expect, vi } from 'vitest';
import { exchangeCode, refreshTokens, describeTokens, HighLevelAuthError, HIGHLEVEL_TOKEN_URL } from '@/lib/highlevel/oauth';

const ENV = { HIGHLEVEL_CLIENT_ID: 'cid', HIGHLEVEL_CLIENT_SECRET: 'csecret', HIGHLEVEL_REDIRECT_URI: 'https://calldesk.tech/api/highlevel/oauth/callback' };
const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
const TOK = { access_token: 'at', refresh_token: 'rt', expires_in: 86399, locationId: 'loc_1', companyId: 'co_1', userId: 'u_1' };

describe('exchangeCode', () => {
  it('posts the form to the token endpoint with a Location user type', async () => {
    const f = ok(TOK);
    expect(await exchangeCode('the-code', ENV, f)).toMatchObject({ access_token: 'at', locationId: 'loc_1' });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(HIGHLEVEL_TOKEN_URL);
    const sent = new URLSearchParams(String(init.body));
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('the-code');
    expect(sent.get('user_type')).toBe('Location');
    expect(sent.get('client_id')).toBe('cid');
    expect(sent.get('redirect_uri')).toBe(ENV.HIGHLEVEL_REDIRECT_URI);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
  it('turns a refusal into an error that does not contain the secret or the code', async () => {
    const err = await exchangeCode('the-code', ENV, ok({ error: 'invalid_grant', error_description: 'Invalid authorization code' }, 400)).catch((e) => e);
    expect(err).toBeInstanceOf(HighLevelAuthError);
    expect(err.status).toBe(400);
    expect(err.message).toContain('Invalid authorization code');
    expect(err.message).not.toContain('csecret');
    expect(err.message).not.toContain('the-code');
  });
  it('rejects a success response that is missing tokens', async () => {
    await expect(exchangeCode('c', ENV, ok({ access_token: 'only' }))).rejects.toThrow(/missing/);
  });
  it('requires the app credentials', async () => {
    await expect(exchangeCode('c', {}, ok(TOK))).rejects.toThrow(/HIGHLEVEL_CLIENT_ID/);
  });
});

describe('refreshTokens', () => {
  it('sends the refresh grant', async () => {
    const f = ok({ ...TOK, access_token: 'at2', refresh_token: 'rt2' });
    expect((await refreshTokens('rt', ENV, f)).refresh_token).toBe('rt2');
    const sent = new URLSearchParams(String(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('refresh_token')).toBe('rt');
  });
});

describe('describeTokens', () => {
  it('reports the shape of a response and never a token', () => {
    const d = describeTokens({ access_token: 'SECRET-AT', refresh_token: 'SECRET-RT', expires_in: 86399, userType: 'Company', companyId: 'co_1', isBulkInstallation: true, approvedLocations: ['a', 'b'], scope: 'contacts.readonly contacts.write' });
    expect(d).toMatchObject({ userType: 'Company', hasCompanyId: true, hasLocationId: false, isBulkInstallation: true, approvedLocationCount: 2, scope: 'contacts.readonly contacts.write' });
    expect(d.fields).toContain('access_token');
    expect(JSON.stringify(d)).not.toContain('SECRET');
  });
});

import { installUrl } from '@/lib/highlevel/oauth';

describe('installUrl', () => {
  const E = { HIGHLEVEL_CLIENT_ID: '6ad125dffee3063416b87588-mv9xcrh1', HIGHLEVEL_REDIRECT_URI: 'https://calldesk.tech/api/highlevel/oauth/callback' };
  it('is HighLevel\'s choose-location page with our client, redirect URL and scopes', () => {
    const u = new URL(installUrl(E)!);
    expect(u.origin + u.pathname).toBe('https://marketplace.gohighlevel.com/oauth/chooselocation');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe(E.HIGHLEVEL_CLIENT_ID);
    expect(u.searchParams.get('redirect_uri')).toBe(E.HIGHLEVEL_REDIRECT_URI);
    expect(u.searchParams.get('scope')).toBe('contacts.readonly contacts.write workflows.readonly');
    expect(installUrl(E)).toContain('scope=contacts.readonly%20contacts.write%20workflows.readonly');
  });
  it('adds the draft version id until the app is published', () => {
    expect(new URL(installUrl(E)!).searchParams.get('version_id')).toBe('6ad125dffee3063416b87588');
    expect(new URL(installUrl({ ...E, HIGHLEVEL_APP_PUBLISHED: 'true' })!).searchParams.has('version_id')).toBe(false);
  });
  it('is null when the app is not configured', () => {
    expect(installUrl({})).toBeNull();
    expect(installUrl({ HIGHLEVEL_CLIENT_ID: 'x' })).toBeNull();
  });
});
