import { describe, it, expect, vi, beforeEach } from 'vitest';

const markStatus = vi.fn();
const markCompanyUninstalled = vi.fn();
const removeSubscriptionsForLocation = vi.fn();
vi.mock('@/lib/highlevel/installs', () => ({ markStatus: (...a: unknown[]) => markStatus(...a), markCompanyUninstalled: (...a: unknown[]) => markCompanyUninstalled(...a) }));
vi.mock('@/lib/highlevel/triggers', () => ({ removeSubscriptionsForLocation: (...a: unknown[]) => removeSubscriptionsForLocation(...a) }));
import { handleAppWebhook } from '@/lib/highlevel/appWebhooks';

const ENV = { HIGHLEVEL_CLIENT_ID: '6ad125dffee3063416b87588-mv9xcrh1' };
beforeEach(() => { vi.clearAllMocks(); markCompanyUninstalled.mockResolvedValue(['loc_a', 'loc_b']); });

describe('handleAppWebhook', () => {
  it('UNINSTALL for a sub-account marks it uninstalled and stops its trigger webhooks', async () => {
    expect(await handleAppWebhook({ type: 'UNINSTALL', appId: '6ad125dffee3063416b87588', locationId: 'loc_1', companyId: 'co_1' }, ENV)).toBe('uninstalled_location');
    expect(markStatus).toHaveBeenCalledWith('loc_1', 'uninstalled');
    expect(removeSubscriptionsForLocation).toHaveBeenCalledWith('loc_1');
    expect(markCompanyUninstalled).not.toHaveBeenCalled();
  });
  it('UNINSTALL for an agency (no location) removes every sub-account under it', async () => {
    expect(await handleAppWebhook({ type: 'UNINSTALL', appId: '6ad125dffee3063416b87588', companyId: 'co_1' }, ENV)).toBe('uninstalled_company');
    expect(markCompanyUninstalled).toHaveBeenCalledWith('co_1');
    expect(removeSubscriptionsForLocation.mock.calls.map((c) => c[0])).toEqual(['loc_a', 'loc_b']);
  });
  it('ignores events for another app, INSTALL and other event types, without touching anything', async () => {
    expect(await handleAppWebhook({ type: 'UNINSTALL', appId: 'someone-elses-app', locationId: 'loc_1' }, ENV)).toBe('ignored_other_app');
    expect(await handleAppWebhook({ type: 'INSTALL', appId: '6ad125dffee3063416b87588', locationId: 'loc_1' }, ENV)).toBe('ignored');
    expect(await handleAppWebhook({ type: 'ContactCreate', locationId: 'loc_1' }, ENV)).toBe('ignored');
    expect(await handleAppWebhook({ type: 'UNINSTALL' }, ENV)).toBe('ignored');
    expect(markStatus).not.toHaveBeenCalled();
    expect(markCompanyUninstalled).not.toHaveBeenCalled();
    expect(removeSubscriptionsForLocation).not.toHaveBeenCalled();
  });
  it('handles an UNINSTALL with no appId when our client id is known (the signature already proves the sender)', async () => {
    expect(await handleAppWebhook({ type: 'UNINSTALL', locationId: 'loc_1' }, ENV)).toBe('uninstalled_location');
  });
  it('is idempotent: a repeated event does the same thing again without error', async () => {
    const e = { type: 'UNINSTALL', appId: '6ad125dffee3063416b87588', locationId: 'loc_1' };
    await handleAppWebhook(e, ENV); await handleAppWebhook(e, ENV);
    expect(markStatus).toHaveBeenCalledTimes(2);
  });
});
