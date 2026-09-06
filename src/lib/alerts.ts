// Alerting engine — turns a finalized call into the emails a tenant asked
// for (see supabase/migrations/010_alert_rules.sql, the /dashboard/alerting
// page, and the wiring in src/app/api/webhooks/retell/route.ts).

import { getSupabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { formatPhoneDisplay } from '@/lib/utils';
import type { RetellCallData } from '@/types';

// The three outcomes a rule can fire on. Same vocabulary as
// calldesk_call_logs.outcome, minus the "success" values (booked/answered).
export type AlertTriggerType = 'transferred' | 'abandoned' | 'voicemail';

// Map Retell's disconnection_reason onto our own outcome enum. Returns one of
// the alertable outcomes, or null when the call just completed normally
// (agent/user hangup after being helped) — in which case we don't touch the
// existing outcome or fire anything.
//
// Reasons per Retell's webhook docs; grouped by what they mean for a
// receptionist:
//   - transferred: the AI handed the caller to a human.
//   - voicemail:   we reached an answering machine / voicemail instead of a person.
//   - abandoned:   the call never really connected (no answer, busy, dial failure).
export function deriveOutcome(call: Pick<RetellCallData, 'disconnection_reason'>): AlertTriggerType | null {
  switch (call.disconnection_reason) {
    case 'call_transfer':
      return 'transferred';
    case 'voicemail_reached':
    case 'machine_detected':
      return 'voicemail';
    case 'dial_no_answer':
    case 'dial_busy':
    case 'dial_failed':
      return 'abandoned';
    default:
      return null;
  }
}

interface AlertRuleRow {
  id: string;
  email: string;
  trigger_type: AlertTriggerType;
}

// Look up enabled rules for (tenant, outcome) and email each recipient.
// Best-effort and never throws: a mail failure must not fail the webhook that
// called it. Returns how many emails were sent (0 when there are no matching
// rules), which is handy for logging/tests.
export async function fireAlertsForCall(params: {
  tenantId: string;
  outcome: AlertTriggerType;
  call: Pick<RetellCallData, 'call_id' | 'from_number' | 'to_number' | 'start_timestamp' | 'end_timestamp'>;
  businessName?: string | null;
}): Promise<number> {
  const { tenantId, outcome, call, businessName } = params;

  try {
    const supabase = getSupabaseAdmin();
    const { data: rules, error } = await supabase
      .from('calldesk_alert_rules')
      .select('id, email, trigger_type')
      .eq('tenant_id', tenantId)
      .eq('trigger_type', outcome)
      .eq('enabled', true);

    if (error) {
      console.error('[alerts] Failed to load alert rules:', error);
      return 0;
    }

    const matching = (rules ?? []) as AlertRuleRow[];
    if (matching.length === 0) return 0;

    const { subject, html, text } = renderAlertEmail({ outcome, call, businessName });

    const results = await Promise.all(
      matching.map((rule) => sendEmail({ to: rule.email, subject, html, text }))
    );

    const sent = results.filter((r) => r.ok).length;
    console.log(`[alerts] tenant=${tenantId} outcome=${outcome} rules=${matching.length} sent=${sent}`);
    return sent;
  } catch (err) {
    console.error('[alerts] fireAlertsForCall threw:', err);
    return 0;
  }
}

const OUTCOME_LABEL: Record<AlertTriggerType, string> = {
  transferred: 'transferred to a human',
  abandoned: 'abandoned',
  voicemail: 'went to voicemail',
};

function renderAlertEmail(params: {
  outcome: AlertTriggerType;
  call: Pick<RetellCallData, 'call_id' | 'from_number' | 'to_number' | 'start_timestamp' | 'end_timestamp'>;
  businessName?: string | null;
}): { subject: string; html: string; text: string } {
  const { outcome, call, businessName } = params;
  const who = businessName ? `${businessName}` : 'your business';
  const caller = call.from_number ? formatPhoneDisplay(call.from_number) : 'Unknown caller';
  const when = call.start_timestamp ? new Date(call.start_timestamp).toLocaleString('en-US') : 'Unknown time';
  const durationSeconds =
    call.end_timestamp && call.start_timestamp
      ? Math.max(0, Math.floor((call.end_timestamp - call.start_timestamp) / 1000))
      : null;
  const duration = durationSeconds != null ? `${durationSeconds}s` : '—';

  const subject = `Call ${OUTCOME_LABEL[outcome]} — ${caller}`;

  const rows: Array<[string, string]> = [
    ['Outcome', OUTCOME_LABEL[outcome]],
    ['Caller', caller],
    ['Received on', call.to_number ? formatPhoneDisplay(call.to_number) : '—'],
    ['Time', when],
    ['Duration', duration],
  ];

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1d29;max-width:520px;margin:0 auto;">
      <h2 style="font-size:18px;margin:0 0 4px;">A call at ${escapeHtml(who)} ${escapeHtml(OUTCOME_LABEL[outcome])}</h2>
      <p style="color:#6b7280;font-size:14px;margin:0 0 16px;">You set up an alert for this. Here are the details:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:8px 0;color:#6b7280;width:130px;">${escapeHtml(label)}</td><td style="padding:8px 0;color:#1a1d29;font-weight:500;">${escapeHtml(value)}</td></tr>`
          )
          .join('')}
      </table>
      <p style="color:#9ca3af;font-size:12px;margin:20px 0 0;">Sent by Calldesk Alerting · manage your alerts in the dashboard.</p>
    </div>
  `.trim();

  const text = [
    `A call at ${who} ${OUTCOME_LABEL[outcome]}.`,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Sent by Calldesk Alerting — manage your alerts in the dashboard.',
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
