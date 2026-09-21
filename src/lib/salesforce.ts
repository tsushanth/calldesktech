// Salesforce CRM sync — DOCUMENTED ONLY, NOT IMPLEMENTED.
//
// bench/parity_report_2026-09-21.html flagged Retell shipping two-way
// Salesforce + HubSpot sync in Jun 2026. This build closes the gap for
// HubSpot only (see src/lib/hubspot.ts). Salesforce is a stretch goal; the
// shape below is real (verified against Salesforce's published REST/OAuth
// docs) so a future pass can implement it without re-researching, but no
// code path here calls any of it and `calldesk_crm_connections.provider`
// accepting 'salesforce' in the DB CHECK constraint does not mean a connect
// flow exists for it.
//
// ## OAuth (Web Server Flow, authorization code + PKCE recommended)
//   Authorize: https://login.salesforce.com/services/oauth2/authorize
//              (or https://test.salesforce.com/... for sandboxes, or the
//              org's My Domain host in production)
//     params: response_type=code, client_id, redirect_uri, scope
//             (e.g. "api refresh_token offline_access")
//   Token:     https://login.salesforce.com/services/oauth2/token
//     POST params: grant_type=authorization_code, code, client_id,
//                  client_secret, redirect_uri
//   Refresh:   same token endpoint, grant_type=refresh_token
//   Token response includes `instance_url` — unlike HubSpot's fixed
//   api.hubapi.com host, every subsequent REST call must be made against
//   THAT org-specific instance, not a shared host. This is the main shape
//   difference from the HubSpot client and the reason a real implementation
//   isn't a copy-paste of hubspot.ts.
//
// ## REST API shape (sObjects), against {instance_url}/services/data/v61.0
//   Create/update Contact:
//     POST   /sobjects/Contact           { LastName, Phone, Email, ... }
//     PATCH  /sobjects/Contact/{id}      { ...fields }
//   Find by phone (SOQL, no native "search by field" REST verb like
//   HubSpot's /search):
//     GET /query?q=SELECT+Id,Name,Phone+FROM+Contact+WHERE+Phone='...'
//   Log a call as a Task (Salesforce's closest analog to a HubSpot Call
//   engagement — there is no separate "Call" sObject by default):
//     POST /sobjects/Task
//       { WhoId: <contactId>, Subject, Description, CallDurationInSeconds,
//         CallType: 'Outbound' | 'Inbound', Status: 'Completed',
//         TaskSubtype: 'Call', ActivityDate }
//
// Not built: no calldesk_crm_connections row is ever created with
// provider='salesforce' by any route in this codebase today.
export const SALESFORCE_NOT_IMPLEMENTED = true;
