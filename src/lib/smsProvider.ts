/**
 * Pluggable SMS provider interface.
 *
 * Supports Twilio, Telnyx, or a no-op provider for testing.
 * Set SMS_PROVIDER env var to 'twilio' | 'telnyx' | 'noop'.
 * Defaults to whichever credentials are available, or noop if none.
 */

export interface SendResult {
  providerSid: string | null;
  status: 'queued' | 'sent' | 'failed';
  error?: string;
}

export interface SmsProvider {
  send(options: { from: string; to: string; body: string }): Promise<SendResult>;
}

// ------------------------------------------------------------------
// Telnyx
// ------------------------------------------------------------------
class TelnyxProvider implements SmsProvider {
  private apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send({ from, to, body }: { from: string; to: string; body: string }): Promise<SendResult> {
    try {
      const res = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, text: body }),
      });
      const data = await res.json() as {
        data?: { id: string; state: string };
        errors?: Array<{ detail: string }>;
      };
      if (!res.ok) {
        const msg = data.errors?.[0]?.detail || `Telnyx error: ${res.status}`;
        return { providerSid: null, status: 'failed', error: msg };
      }
      return {
        providerSid: data.data?.id ?? null,
        status: data.data?.state === 'accepted' || data.data?.state === 'queued' ? 'queued' : 'sent',
      };
    } catch (err) {
      return { providerSid: null, status: 'failed', error: err instanceof Error ? err.message : 'Telnyx request failed' };
    }
  }
}

// ------------------------------------------------------------------
// Twilio
// ------------------------------------------------------------------
class TwilioProvider implements SmsProvider {
  private accountSid: string;
  private authToken: string;
  constructor(accountSid: string, authToken: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
  }

  async send({ from, to, body }: { from: string; to: string; body: string }): Promise<SendResult> {
    try {
      const auth64 = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const form = new URLSearchParams();
      form.set('From', from);
      form.set('To', to);
      form.set('Body', body);
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth64}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const data = await res.json() as { sid?: string; error_message?: string; status?: string };
      if (!res.ok) {
        return { providerSid: null, status: 'failed', error: data.error_message || `Twilio error: ${res.status}` };
      }
      return { providerSid: data.sid ?? null, status: 'queued' };
    } catch (err) {
      return { providerSid: null, status: 'failed', error: err instanceof Error ? err.message : 'Twilio request failed' };
    }
  }
}

// ------------------------------------------------------------------
// No-op (records in DB but never sends)
// ------------------------------------------------------------------
class NoopProvider implements SmsProvider {
  async send(): Promise<SendResult> {
    return { providerSid: null, status: 'queued', error: 'No SMS provider configured — message recorded locally only' };
  }
}

// ------------------------------------------------------------------
// Factory
// ------------------------------------------------------------------
export function getSmsProvider(): SmsProvider {
  const providerType = process.env.SMS_PROVIDER?.toLowerCase();

  if (providerType === 'telnyx' || providerType === undefined) {
    const key = process.env.TELNYX_API_KEY;
    if (key) return new TelnyxProvider(key);
  }

  if (providerType === 'twilio' || providerType === undefined) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (sid && token) return new TwilioProvider(sid, token);
  }

  if (providerType === 'noop') {
    return new NoopProvider();
  }

  // Default to noop with a clear error when explicitly requested provider is missing
  return new NoopProvider();
}
