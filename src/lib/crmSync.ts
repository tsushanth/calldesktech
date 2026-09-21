// Glue between CallDesk's own data (tenants, call logs) and the HubSpot
// client in src/lib/hubspot.ts: token refresh, the us→CRM call-completion
// sync, and the CRM→us lookup used for dynamic variables.
import { getSupabaseAdmin } from '@/lib/supabase';
import { hubspotClient, refreshHubSpotToken, HubSpotApiError } from '@/lib/hubspot';

interface CrmConnectionRow {
  id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

/** Loads the tenant's HubSpot connection (if any) and refreshes the access
 * token first if it's within 2 minutes of expiring — HubSpot access tokens
 * only last 30 minutes, so a long call-processing pipeline needs this on
 * essentially every use. Returns null if no connection exists. */
async function getHubspotConnection(tenantId: string): Promise<CrmConnectionRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_crm_connections')
    .select('id, access_token, refresh_token, expires_at')
    .eq('tenant_id', tenantId)
    .eq('provider', 'hubspot')
    .maybeSingle();
  if (error || !data) return null;

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < 2 * 60 * 1000;
  if (!needsRefresh || !data.refresh_token) return data;

  try {
    const tokens = await refreshHubSpotToken(data.refresh_token);
    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await supabase
      .from('calldesk_crm_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: newExpiresAt,
      })
      .eq('id', data.id);
    return { ...data, access_token: tokens.access_token, expires_at: newExpiresAt };
  } catch (err) {
    console.error('HubSpot token refresh failed for tenant', tenantId, err instanceof Error ? err.message : err);
    // Fall back to the (possibly-expired) token; the caller's HubSpot call
    // will fail cleanly with a 401 rather than us guessing.
    return data;
  }
}

export interface CallForSync {
  callerPhone: string;
  outcome: string;
  durationSeconds: number;
  transcriptSummary: string;
  direction: 'INBOUND' | 'OUTBOUND';
  startedAt: string; // ISO
}

/** us→CRM: upsert the caller as a Contact and log the call as a Call
 * engagement. Called from the call.completed webhook dispatch point
 * (src/app/api/webhooks/retell/route.ts) — never throws, mirroring how
 * dispatchWebhookEvent swallows delivery failures so one tenant's bad/expired
 * CRM connection can't break call processing for anyone. */
export async function syncCallToHubSpot(tenantId: string, call: CallForSync): Promise<void> {
  try {
    const connection = await getHubspotConnection(tenantId);
    if (!connection) return; // not connected — nothing to do

    const client = hubspotClient(connection.access_token);
    const contact = await client.upsertContactByPhone(call.callerPhone, {
      hs_lead_status: 'OPEN',
    });
    await client.logCall({
      contactId: contact.id,
      title: `CallDesk call — ${call.outcome}`,
      body: call.transcriptSummary,
      durationMs: call.durationSeconds * 1000,
      direction: call.direction,
      timestamp: call.startedAt,
    });
  } catch (err) {
    const detail =
      err instanceof HubSpotApiError ? `${err.status} ${err.body.slice(0, 200)}` : err instanceof Error ? err.message : String(err);
    console.error(`HubSpot sync failed for tenant ${tenantId}:`, detail);
  }
}

export interface CrmPersonalizationVars {
  crm_contact_found: 'true' | 'false';
  crm_first_name?: string;
  crm_last_name?: string;
  crm_company_name?: string;
  crm_email?: string;
  crm_job_title?: string;
}

/** CRM→us: on-demand lookup at call time, exposed as dynamic variables
 * (e.g. {{crm_company_name}}) an agent flow can reference. A lookup, not a
 * poll — no background sync job. */
export async function lookupHubspotContactVars(
  tenantId: string,
  phone: string
): Promise<CrmPersonalizationVars> {
  const notFound: CrmPersonalizationVars = { crm_contact_found: 'false' };
  try {
    const connection = await getHubspotConnection(tenantId);
    if (!connection) return notFound;
    const client = hubspotClient(connection.access_token);
    const contact = await client.findContactByPhone(phone);
    if (!contact) return notFound;
    const p = contact.properties;
    return {
      crm_contact_found: 'true',
      crm_first_name: p.firstname ?? undefined,
      crm_last_name: p.lastname ?? undefined,
      crm_company_name: p.company ?? undefined,
      crm_email: p.email ?? undefined,
      crm_job_title: p.jobtitle ?? undefined,
    };
  } catch (err) {
    console.error(`HubSpot lookup failed for tenant ${tenantId}:`, err instanceof Error ? err.message : err);
    return notFound;
  }
}
