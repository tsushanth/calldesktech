import { getSupabaseAdmin } from '@/lib/supabase';
import { decryptToken, encryptToken } from './crypto';
import { HighLevelAuthError, refreshTokens, type HighLevelTokens } from './oauth';

// Storage for HighLevel app installs (calldesk_highlevel_installs, migration 079).
// Tokens never leave this module in clear text except through getAccessToken.

const TABLE = 'calldesk_highlevel_installs';
const REFRESH_MARGIN_MS = 5 * 60_000;

export interface HighLevelInstall {
  location_id: string;
  company_id: string | null;
  tenant_id: string | null;
  status: 'active' | 'needs_reauth' | 'uninstalled';
  expires_at: string;
  access_token: string;
  refresh_token: string;
}

const expiresAt = (seconds: number, now: number) => new Date(now + seconds * 1000).toISOString();

/** Store (or re-store) an install from a token response. A reinstall keeps the workspace link. */
export async function saveInstall(tokens: HighLevelTokens, now: number = Date.now()): Promise<{ ok: true; locationId: string } | { ok: false; error: string }> {
  if (!tokens.locationId) return { ok: false, error: 'No sub-account (location) in the HighLevel token. Install the app from a sub-account.' };
  const row = {
    location_id: tokens.locationId,
    company_id: tokens.companyId ?? null,
    hl_user_id: tokens.userId ?? null,
    access_token: encryptToken(tokens.access_token),
    refresh_token: encryptToken(tokens.refresh_token),
    expires_at: expiresAt(tokens.expires_in, now),
    status: 'active',
    uninstalled_at: null,
    updated_at: new Date(now).toISOString(),
  };
  const { error } = await getSupabaseAdmin().from(TABLE).upsert(row, { onConflict: 'location_id' });
  if (error) return { ok: false, error: 'Could not save the install' };
  return { ok: true, locationId: tokens.locationId };
}

export async function getInstall(locationId: string): Promise<HighLevelInstall | null> {
  const { data } = await getSupabaseAdmin()
    .from(TABLE)
    .select('location_id, company_id, tenant_id, status, expires_at, access_token, refresh_token')
    .eq('location_id', locationId)
    .maybeSingle();
  return (data as HighLevelInstall | null) ?? null;
}

/** Link an install to a Calldesk workspace. Returns false when there is no active install for the location. */
export async function linkTenant(locationId: string, tenantId: string, now: number = Date.now()): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from(TABLE)
    .update({ tenant_id: tenantId, linked_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() })
    .eq('location_id', locationId)
    .eq('status', 'active')
    .select('location_id');
  return Array.isArray(data) && data.length > 0;
}

export async function markStatus(locationId: string, status: 'needs_reauth' | 'uninstalled', now: number = Date.now()): Promise<void> {
  await getSupabaseAdmin()
    .from(TABLE)
    .update({ status, updated_at: new Date(now).toISOString(), ...(status === 'uninstalled' ? { uninstalled_at: new Date(now).toISOString() } : {}) })
    .eq('location_id', locationId);
}

/** Mark every install under an agency (company) as uninstalled. Returns the sub-accounts that were active, so their trigger webhooks can be removed. */
export async function markCompanyUninstalled(companyId: string, now: number = Date.now()): Promise<string[]> {
  const db = getSupabaseAdmin();
  const { data } = await db.from(TABLE).select('location_id').eq('company_id', companyId).neq('status', 'uninstalled');
  const locations = ((data ?? []) as Array<{ location_id: string }>).map((r) => r.location_id);
  if (locations.length) {
    await db.from(TABLE).update({ status: 'uninstalled', uninstalled_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }).eq('company_id', companyId).neq('status', 'uninstalled');
  }
  return locations;
}

/**
 * A valid access token for a location, refreshing it when it is within five minutes of expiry.
 * The refresh token rotates on every use, so the update is guarded by the old refresh token: if another request
 * refreshed first, this one re-reads and uses that result instead of overwriting it with a stale token.
 * A refused refresh (400 or 401) marks the install needs_reauth.
 */
export async function getAccessToken(
  locationId: string,
  opts: { now?: number; refresh?: typeof refreshTokens } = {},
): Promise<string> {
  const now = opts.now ?? Date.now();
  const refresh = opts.refresh ?? refreshTokens;
  const install = await getInstall(locationId);
  if (!install) throw new Error('HighLevel install not found');
  if (install.status !== 'active') throw new Error(`HighLevel install is ${install.status}`);
  if (new Date(install.expires_at).getTime() - now > REFRESH_MARGIN_MS) return decryptToken(install.access_token);

  let fresh: HighLevelTokens;
  try {
    fresh = await refresh(decryptToken(install.refresh_token));
  } catch (e) {
    if (e instanceof HighLevelAuthError && (e.status === 400 || e.status === 401)) await markStatus(locationId, 'needs_reauth', now);
    throw e;
  }
  const { data } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      access_token: encryptToken(fresh.access_token),
      refresh_token: encryptToken(fresh.refresh_token),
      expires_at: expiresAt(fresh.expires_in, now),
      updated_at: new Date(now).toISOString(),
    })
    .eq('location_id', locationId)
    .eq('refresh_token', install.refresh_token)
    .select('location_id');
  if (Array.isArray(data) && data.length > 0) return fresh.access_token;

  // Lost the race: someone else rotated the token. Use theirs.
  const latest = await getInstall(locationId);
  if (!latest || latest.status !== 'active') throw new Error('HighLevel install is no longer active');
  return decryptToken(latest.access_token);
}
