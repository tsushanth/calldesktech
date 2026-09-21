import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { unsubscribeUrl } from './unsubscribe';

// The only path that emails a real prospect. Every guard below must pass:
// approved by a human, address configured (CAN-SPAM), recipient not
// suppressed, and under the daily cap. Failures are recorded on the message
// row and returned; nothing here throws for an expected refusal.

const DEFAULT_DAILY_CAP = 20;

// Per-product identity for the footer and the env vars that gate sending.
// 'calldesk' (the default/unprefixed product) keeps using the original env
// var names so nothing about the existing Calldesk pipeline changes.
interface Brand { name: string; siteUrl: string; fromEnvVar: string; postalEnvVar: string; capEnvVar: string }
const CALLDESK_BRAND: Brand = { name: 'Calldesk', siteUrl: 'calldesk.tech', fromEnvVar: 'OUTREACH_FROM_EMAIL', postalEnvVar: 'OUTREACH_POSTAL_ADDRESS', capEnvVar: 'OUTREACH_DAILY_CAP' };
const KREATIVE_KOALA_BRAND: Brand = { name: 'Kreative Koala LLC', siteUrl: 'kreativekoala.llc', fromEnvVar: 'OUTREACH_FROM_EMAIL_KK', postalEnvVar: 'OUTREACH_POSTAL_ADDRESS_KK', capEnvVar: 'OUTREACH_DAILY_CAP_KK' };

function brandFor(product: string): Brand {
  return product.startsWith('kreativekoala') ? KREATIVE_KOALA_BRAND : CALLDESK_BRAND;
}

// The cap resets at local midnight in OUTREACH_TZ (default Pacific), not at UTC midnight.
export function startOfDayInTz(now = new Date(), tz = process.env.OUTREACH_TZ || 'America/Los_Angeles'): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  const offset = localAsUtc - now.getTime();
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offset);
}

export function capResetLabel(now = new Date(), tz = process.env.OUTREACH_TZ || 'America/Los_Angeles'): string {
  const reset = new Date(startOfDayInTz(now, tz).getTime() + 24 * 3600_000);
  return reset.toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sentTodayCount(supabase: SupabaseClient<any>, product = 'calldesk'): Promise<number> {
  const { count } = await supabase
    .from('calldesk_outreach_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .eq('product', product)
    .gte('sent_at', startOfDayInTz().toISOString());
  return count ?? 0;
}

export function dailyCap(product = 'calldesk'): number {
  const n = Number(process.env[brandFor(product).capEnvVar]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildFooter(email: string, postalAddress: string, brand: Brand = CALLDESK_BRAND): { text: string; html: string } {
  const link = unsubscribeUrl(email);
  const text = `\n\n--\n${brand.name} (${brand.siteUrl})\n${postalAddress}\nYou're receiving this because your business contact address is published on your website. Not interested? Unsubscribe: ${link}`;
  const html =
    `<p style="color:#6b7280;font-size:12px;margin-top:24px">${escapeHtml(brand.name)} (${brand.siteUrl})<br/>` +
    `${escapeHtml(postalAddress)}<br/>You're receiving this because your business contact address is published on your website. Not interested? <a href="${link}">Unsubscribe</a></p>`;
  return { text, html };
}

export type SendOutcome = { ok: true; resendId?: string } | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendApprovedMessage(supabase: SupabaseClient<any>, messageId: string): Promise<SendOutcome> {
  const { data: msg, error } = await supabase.from('calldesk_outreach_messages').select('*').eq('id', messageId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!msg) return { ok: false, error: 'Message not found' };
  if (msg.status !== 'approved') return { ok: false, error: `Message is "${msg.status}", only approved messages can be sent` };

  const product = (msg.product as string) || 'calldesk';
  const brand = brandFor(product);
  const postalAddress = (process.env[brand.postalEnvVar] || '').trim();
  if (!postalAddress) {
    return { ok: false, error: `${brand.postalEnvVar} is not set; sending is blocked until a mailing address is configured` };
  }
  const from = (process.env[brand.fromEnvVar] || '').trim();
  if (!from) return { ok: false, error: `${brand.fromEnvVar} is not set` };

  const { data: lead } = await supabase.from('calldesk_outreach_leads').select('region_blocked').eq('id', msg.lead_id).maybeSingle();
  if (lead?.region_blocked) {
    await supabase.from('calldesk_outreach_messages').update({ status: 'failed', error: 'lead is in an excluded region (DE/AT/CH)' }).eq('id', messageId);
    return { ok: false, error: 'This lead is in an excluded region (Germany/Austria/Switzerland); not sending' };
  }

  const toEmail = String(msg.to_email).trim().toLowerCase();

  const { data: suppressed } = await supabase.from('calldesk_outreach_suppressions').select('id').eq('email', toEmail).maybeSingle();
  if (suppressed) {
    await supabase.from('calldesk_outreach_messages').update({ status: 'failed', error: 'recipient is suppressed' }).eq('id', messageId);
    return { ok: false, error: 'Recipient has unsubscribed' };
  }

  if ((await sentTodayCount(supabase, product)) >= dailyCap(product)) {
    return { ok: false, error: `Daily send cap (${dailyCap(product)}) reached. It resets ${capResetLabel()}.` };
  }

  const footer = buildFooter(toEmail, postalAddress, brand);
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
