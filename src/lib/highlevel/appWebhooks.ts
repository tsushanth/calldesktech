import { markCompanyUninstalled, markStatus } from './installs';
import { removeSubscriptionsForLocation } from './triggers';

// What to do with a verified HighLevel app webhook. Everything here is idempotent: HighLevel may deliver an event more than once.
//  - UNINSTALL for a sub-account: mark the install uninstalled (tokens stay encrypted but are never used again) and stop sending call
//    results to its workflows. An agency-level uninstall does the same for every sub-account under the company.
//  - INSTALL needs nothing here: the OAuth callback stores the install.
// Events for another app (the signature only proves the sender is HighLevel) are ignored.

export type AppWebhookResult = 'uninstalled_location' | 'uninstalled_company' | 'ignored_other_app' | 'ignored';

export async function handleAppWebhook(payload: Record<string, unknown>, env: Record<string, string | undefined> = process.env): Promise<AppWebhookResult> {
  const ourAppId = (env.HIGHLEVEL_CLIENT_ID ?? '').split('-')[0];
  if (typeof payload.appId === 'string' && payload.appId && ourAppId && payload.appId !== ourAppId) return 'ignored_other_app';
  if (payload.type !== 'UNINSTALL') return 'ignored';

  const locationId = typeof payload.locationId === 'string' ? payload.locationId : '';
  if (locationId) {
    await markStatus(locationId, 'uninstalled');
    await removeSubscriptionsForLocation(locationId);
    return 'uninstalled_location';
  }
  const companyId = typeof payload.companyId === 'string' ? payload.companyId : '';
  if (companyId) {
    for (const loc of await markCompanyUninstalled(companyId)) await removeSubscriptionsForLocation(loc);
    return 'uninstalled_company';
  }
  return 'ignored';
}
