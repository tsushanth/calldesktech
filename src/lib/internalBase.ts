// Where this server reaches ITSELF (for example the SMS webhook handing a trial message to /api/webhooks/trial-sms).
// Never derive it from the request's Host or X-Forwarded-* headers: those are attacker-controlled, and these
// self-calls carry INTERNAL_WEBHOOK_SECRET.
export function internalBaseUrl(): string {
  return (process.env.INTERNAL_APP_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '');
}
