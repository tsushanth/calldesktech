import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { unsubscribeUrl } from './unsubscribe';

// The only path that emails a real prospect. Every guard below must pass:
// approved by a human, address configured (CAN-SPAM), recipient not
// suppressed, and under the daily cap. Failures are recorded on the message
// row and returned; nothing here throws for an expected refusal.

const DEFAULT_DAILY_CAP = 20;

export function dailyCap(): number {
  const n = Number(process.env.OUTREACH_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildFooter(email: string, postalAddress: string): { text: string; html: string } {
  const link = unsubscribeUrl(email);
  const text = `\n\n--\nSushanth, Calldesk (calldesk.tech)\n${postalAddress}\nNot interested? Unsubscribe: ${link}`;
  const html =
    `<p style="color:#6b7280;font-size:12px;margin-top:24px">Sushanth, Calldesk (calldesk.tech)<br/>` +
    `${escapeHtml(postalAddress)}<br/>Not interested? <a href="${link}">Unsubscribe</a></p>`;
  return { text, html };
}

export type SendOutcome = { ok: true; resendId?: string } | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendApprovedMessage(supabase: SupabaseClient<any>, messageId: string): Promise<SendOutcome> {
  const postalAddress = (process.env.OUTREACH_POSTAL_ADDRESS || '').trim();
  if (!postalAddress) {
    return { ok: false, error: 'OUTREACH_POSTAL_ADDRESS is not set; sending is blocked until a mailing address is configured' };
  }
  const from = (process.env.OUTREACH_FROM_EMAIL || '').trim();
  if (!from) return { ok: false, error: 'OUTREACH_FROM_EMAIL is not set' };

  const { data: msg, error } = await supabase.from('calldesk_outreach_messages').select('*').eq('id', messageId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!msg) return { ok: false, error: 'Message not found' };
  if (msg.status !== 'approved') return { ok: false, error: `Message is "${msg.status}", only approved messages can be sent` };

  const toEmail = String(msg.to_email).trim().toLowerCase();

  const { data: suppressed } = await supabase.from('calldesk_outreach_suppressions').select('id').eq('email', toEmail).maybeSingle();
  if (suppressed) {
    await supabase.from('calldesk_outreach_messages').update({ status: 'failed', error: 'recipient is suppressed' }).eq('id', messageId);
    return { ok: false, error: 'Recipient has unsubscribed' };
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('calldesk_outreach_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', startOfDay.toISOString());
  if ((count ?? 0) >= dailyCap()) {
    return { ok: false, error: `Daily send cap (${dailyCap()}) reached; try again tomorrow` };
  }

  const footer = buildFooter(toEmail, postalAddress);
  const paragraphs = String(msg.body_text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1d29;max-width:560px">${paragraphs}${footer.html}</div>`;

  const result = await sendEmail({
    to: toEmail,
    subject: msg.subject,
    html,
    text: `${msg.body_text}${footer.text}`,
    from,
    replyTo: from.match(/<(.+)>/)?.[1] || from,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl(toEmail)}>` },
  });

  if (!result.ok) {
    await supabase.from('calldesk_outreach_messages').update({ status: 'failed', error: result.error || 'send failed' }).eq('id', messageId);
    return { ok: false, error: result.error || 'send failed' };
  }

  await supabase
    .from('calldesk_outreach_messages')
    .update({ status: 'sent', sent_at: new Date().toISOString(), resend_id: result.id ?? null, error: null })
    .eq('id', messageId);
  await supabase.from('calldesk_outreach_leads').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', msg.lead_id);
  return { ok: true, resendId: result.id };
}
