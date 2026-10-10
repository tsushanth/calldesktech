// Machine-readable HighLevel workflow recipes shown on /docs/highlevel. Placeholders only: never real keys or ids.
export const CALLDESK_BASE = 'https://calldesk.tech/api/v1';

export const WORKFLOW_A = {
  name: 'Place a Calldesk call',
  trigger: { type: 'any HighLevel trigger that has a contact with a phone, e.g. Contact Tagged "call-me" or Form Submitted' },
  actions: [
    {
      type: 'Custom Webhook',
      method: 'POST',
      url: `${CALLDESK_BASE}/phone-numbers/<YOUR_CALLDESK_PHONE_NUMBER_ID>/call`,
      headers: [
        { key: 'Authorization', value: 'Bearer <YOUR_CALLDESK_API_KEY>' },
        { key: 'Content-Type', value: 'application/json' },
      ],
      body_mode: 'raw JSON (event CUSTOM)',
      body: {
        toNumber: '{{contact.phone}}',
        variables: {
          first_name: '{{contact.first_name}}',
          last_name: '{{contact.last_name}}',
          email: '{{contact.email}}',
          reason: 'Following up on your enquiry',
        },
      },
    },
  ],
};

export const WORKFLOW_B = {
  name: 'Calldesk call completed',
  trigger: { type: 'Inbound Webhook', method: 'POST', url: '<URL_HIGHLEVEL_SHOWS_YOU_ON_THE_TRIGGER>' },
  calldesk_registration: { where: 'Calldesk dashboard, Integrations, Webhooks', url: '<URL_HIGHLEVEL_SHOWS_YOU_ON_THE_TRIGGER>', events: ['call.completed'], format: 'flat' },
  actions: [
    { type: 'Create/Update Contact', map: { phone: 'phone', email: 'email', name: 'name' } },
    { type: 'Add Note', body: 'Calldesk call ({{inboundWebhookRequest.direction}}, {{inboundWebhookRequest.duration_seconds}}s): {{inboundWebhookRequest.summary}} Transcript: {{inboundWebhookRequest.transcript_url}}' },
    { type: 'If/Else', condition: 'outcome equals transferred', then: [{ type: 'Add Tag', tag: 'calldesk-transferred' }] },
    { type: 'Add Tag', tag: 'calldesk-called' },
  ],
  note: 'The exact merge-field names for received data come from the picker in your workflow after you send a test event; the inboundWebhookRequest.* names above are indicative.',
};

export const FLAT_EXAMPLE = {
  event: 'call.completed',
  created_at: '2026-10-09T18:01:00.000Z',
  call_id: 'CA0123456789abcdef',
  phone: '+14155550123',
  name: 'Dana Lee',
  email: 'dana@example.com',
  summary: 'Dana asked to move her appointment to Friday at 3pm. Confirmed.',
  outcome: 'answered',
  duration_seconds: 42,
  direction: 'outbound',
  transcript_url: 'https://calldesk.tech/dashboard/calls/<call-log-id>',
  started_at: '2026-10-09T18:00:00.000Z',
  ended_at: '2026-10-09T18:00:42.000Z',
  agent_name: 'Reminder agent',
  var_first_name: 'Dana',
  var_reason: 'Following up on your enquiry',
};

// Simple YAML emitter for the recipe objects (no dependency).
export function toYaml(v: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (x && typeof x === 'object') {
        const inner = toYaml(x, indent + 1).replace(/^\s+/, '');
        return `${pad}- ${inner}`;
      }
      return `${pad}- ${JSON.stringify(x)}`;
    }).join('\n');
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).map(([k, x]) => {
      if (x && typeof x === 'object') return `${pad}${k}:\n${toYaml(x, indent + 1)}`;
      return `${pad}${k}: ${JSON.stringify(x)}`;
    }).join('\n');
  }
  return `${pad}${JSON.stringify(v)}`;
}
