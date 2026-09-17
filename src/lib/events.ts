// Fired on `window` whenever a tenant's phone numbers change (bought,
// registered, deleted) from anywhere in the dashboard, so the persistent
// sidebar in layout.tsx — which only fetches on tenant switch, not on route
// change — can refetch and drop the "Setup required" state immediately
// instead of only updating after a manual navigation back to it.
export const PHONE_NUMBERS_CHANGED_EVENT = 'calldesk:phone-numbers-changed';

export function notifyPhoneNumbersChanged() {
  window.dispatchEvent(new Event(PHONE_NUMBERS_CHANGED_EVENT));
}
