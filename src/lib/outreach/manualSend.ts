import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail as defaultSendEmail, type SendEmailParams, type SendEmailResult } from '@/lib/email';
import { oneClickUnsubscribeUrl } from './unsubscribe';
import { adminEmails } from './config';

// One-off emails from the outreach address: replies to prospects and partners, sent through the same
// Resend sender and domain as the automated outreach (so the main domain keeps its reputation), copied
// to the owner by BCC, and logged to calldesk_outreach_manual_sends. Personal mail (interviews, job
// search) does NOT go through here; that stays in the owner's own Gmail.

export type ReplyBrand = 'calldesk' | 'readaloud';

const BRAND_ENV: Record<ReplyBrand, { from: string; replyTo: string; apiKey?: string }> = {
  calldesk: { from: 'OUTREACH_FROM_EMAIL', replyTo: 'OUTREACH_REPLYTO_EMAIL', apiKey: 'OUTREACH_RESEND_API_KEY' },
  readaloud: { from: 'OUTREACH_FROM_EMAIL_READALOUD', replyTo: 'OUTREACH_REPLYTO_EMAIL_READALOUD' },
};

export interface ManualReplyInput {
  to: string;
  subject: string;
  body: string;
  brand?: ReplyBrand;
  inReplyTo?: string;
  leadId?: string;
  bcc?: string[];
  allowNonAscii?: boolean;
}

export interface ValidReply {
  to: string;
  subject: string;
  body: string;
  brand: ReplyBrand;
  inReplyTo?: string;
  leadId?: string;
  bcc: string[];
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const MSGID_RE = /^<[^<>\s]+@[^<>\s]+>$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateReply(
  input: Partial<ManualReplyInput> | null | undefined,
  env: Record<string, string | undefined> = process.env,
): { ok: true; value: ValidReply } | { ok: false; error: string } {
  const to = String(input?.to ?? '').trim().toLowerCase();
  const subject = String(input?.subject ?? '').trim();
  const body = String(input?.body ?? '').replace(/\r\n/g, '\n').trim();
  const brand = (input?.brand ?? 'calldesk') as ReplyBrand;
  if (!EMAIL_RE.test(to)) return { ok: false, error: 'to must be one valid email address' };
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) return { ok: false, error: 'subject is required, one line, 200 characters at most' };
  if (!body || body.length > 20000) return { ok: false, error: 'body is required, 20000 characters at most' };
  if (!(brand in BRAND_ENV)) return { ok: false, error: `brand must be one of ${Object.keys(BRAND_ENV).join(', ')}` };
  if (input?.inReplyTo && !MSGID_RE.test(input.inReplyTo)) return { ok: false, error: 'inReplyTo must look like <id@host>' };
  if (input?.leadId && !UUID_RE.test(input.leadId)) return { ok: false, error: 'leadId must be a UUID' };
  if (!input?.allowNonAscii) {
    const bad = (subject + body).match(/[^\x09\x0A\x20-\x7E]/);
    if (bad) return { ok: false, error: `contains a non-ASCII character (${JSON.stringify(bad[0])}); use plain ASCII with no em dashes, or pass allowNonAscii` };
  }
  const bccRaw = input?.bcc ?? (env.OUTREACH_REPLY_BCC ? env.OUTREACH_REPLY_BCC.split(',') : adminEmails().slice(0, 1));
  const bcc = bccRaw.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (bcc.length > 3 || bcc.some((e) => !EMAIL_RE.test(e))) return { ok: false, error: 'bcc must be up to 3 valid email addresses' };
  return { ok: true, value: { to, subject, body, brand, inReplyTo: input?.inReplyTo, leadId: input?.leadId, bcc } };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const replyHtml = (text: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;

export type ManualSendResult = { ok: true; id?: string; from: string; replyTo: string; bcc: string[] } | { ok: false; error: string };

export async function sendManualReply(
  db: SupabaseClient,
  input: Partial<ManualReplyInput> | null | undefined,
  opts: { sentBy?: string; env?: Record<string, string | undefined>; send?: (p: SendEmailParams) => Promise<SendEmailResult> } = {},
): Promise<ManualSendResult> {
  const env = opts.env ?? process.env;
  const send = opts.send ?? defaultSendEmail;
  const v = validateReply(input, env);
  if (!v.ok) return v;
  const r = v.value;
  const cfg = BRAND_ENV[r.brand];
  const from = env[cfg.from];
  if (!from) return { ok: false, error: `${cfg.from} is not configured` };
  const replyTo = env[cfg.replyTo] || from.match(/<(.+)>/)?.[1] || from;

  const { data: suppressed } = await db.from('calldesk_outreach_suppressions').select('email').eq('email', r.to).maybeSingle();
  if (suppressed) return { ok: false, error: 'Recipient has unsubscribed or is suppressed' };

  const headers: Record<string, string> = { 'List-Unsubscribe': `<${oneClickUnsubscribeUrl(r.to)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  if (r.inReplyTo) { headers['In-Reply-To'] = r.inReplyTo; headers['References'] = r.inReplyTo; }
  const result = await send({
    to: r.to, subject: r.subject, html: replyHtml(r.body), text: r.body, from, replyTo, headers,
    ...(r.bcc.length ? { bcc: r.bcc } : {}),
    apiKey: (cfg.apiKey && env[cfg.apiKey]) || undefined,
  });

  const { error: logError } = await db.from('calldesk_outreach_manual_sends').insert({
    brand: r.brand, to_email: r.to, subject: r.subject, body_text: r.body, from_email: from, reply_to: replyTo, bcc: r.bcc,
    in_reply_to: r.inReplyTo ?? null, lead_id: r.leadId ?? null, status: result.ok ? 'sent' : 'failed',
    resend_id: result.id ?? null, error: result.ok ? null : result.error ?? 'send failed', sent_by: opts.sentBy ?? null,
  });
  if (logError) console.warn('[outreach/manualSend] could not log the send:', logError.message);
  if (!result.ok) return { ok: false, error: result.error || 'send failed' };
  return { ok: true, id: result.id, from, replyTo, bcc: r.bcc };
}
