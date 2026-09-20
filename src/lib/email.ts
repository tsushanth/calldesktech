// Transactional email via Resend. No provider was configured in this repo
// before Alerting (no Resend/SendGrid/nodemailer in package.json), so Resend
// is introduced here — the same provider used across this author's other
// projects. We talk to Resend's REST API directly with fetch rather than
// pulling in the `resend` SDK: it's a single POST, and it keeps the
// dependency/lockfile surface untouched.
//
// Requires two secrets to actually send:
//   RESEND_API_KEY   — Resend API key (re_...). MUST be added as a real secret.
//   ALERT_FROM_EMAIL — verified sender, e.g. "Calldesk Alerts <alerts@yourdomain.com>".
//                      Falls back to Resend's onboarding@resend.dev sandbox
//                      sender, which only delivers to the account owner.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  // Optional overrides (used by outreach): sender, reply-to, extra headers
  // such as List-Unsubscribe. Alerting callers leave these unset.
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

// Never throws — email failures should degrade gracefully (a missed alert
// must not, for instance, fail the webhook that finalizes a call).
export async function sendEmail({ to, subject, html, text, from: fromOverride, replyTo, headers }: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not configured — skipping send to', to);
    return { ok: false, skipped: true, error: 'RESEND_API_KEY not configured' };
  }

  const from = fromOverride || process.env.ALERT_FROM_EMAIL || 'Calldesk Alerts <onboarding@resend.dev>';

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}), ...(headers ? { headers } : {}) }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[email] Resend send failed:', res.status, body);
      return { ok: false, error: `Resend responded ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (error) {
    console.error('[email] Resend send threw:', error);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
