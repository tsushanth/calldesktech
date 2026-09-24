import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { unsubscribeUrl } from './unsubscribe';
import { renderOutreachEmail, escapeHtml, type EmailSample } from './emailHtml';
import { getPublishedSample, pickVariant, sampleTokenFor, sampleUrl, snippetLines, productSlug } from './samples';

// The only path that emails a real prospect. A human still triggers every
// send explicitly from the admin queue (draft or approved status both
// qualify -- there is no automated send). Every guard below must pass:
// address configured (CAN-SPAM), recipient not suppressed. Failures are
// recorded on the message row and returned; nothing here throws for an
// expected refusal. dailyCap()/sentTodayCount() below are informational only
// (shown in the admin UI) and no longer enforced here.

const DEFAULT_DAILY_CAP = 20;

// Per-product identity for the footer and the env vars that gate sending.
// 'calldesk' (the default/unprefixed product) keeps using the original env
// var names so nothing about the existing Calldesk pipeline changes.
export interface Brand { name: string; siteUrl: string; fromEnvVar: string; postalEnvVar: string; capEnvVar: string; replyToEnvVar?: string }
// Sending domains use a dedicated `send.` subdomain (Resend/DNS convention, keeps
// bulk-sending reputation isolated from the root domain); replies route through
// the bare domain via Cloudflare Email Routing, so replyToEnvVar differs from
// fromEnvVar wherever that split applies.
const CALLDESK_BRAND: Brand = { name: 'Calldesk', siteUrl: 'calldesk.tech', fromEnvVar: 'OUTREACH_FROM_EMAIL', postalEnvVar: 'OUTREACH_POSTAL_ADDRESS', capEnvVar: 'OUTREACH_DAILY_CAP' };

// Each Kreative Koala app sends from its OWN identity, not a shared one --
// four apps have their own domain (already verified in Resend); the three
// without one (VoxKey, Pixora, GymLog -- Kreative Koala LLC is their real
// publisher either way) get a distinct address on the parent domain instead
// of a shared generic "outreach@" sender. All seven still share one postal
// address and one daily send cap (same legal entity, same footer text).
const KK_POSTAL_ENV = 'OUTREACH_POSTAL_ADDRESS_KK';
const KK_CAP_ENV = 'OUTREACH_DAILY_CAP_KK';
const KK_APP_BRANDS: Record<string, Omit<Brand, 'postalEnvVar' | 'capEnvVar'>> = {
  simplyapply: { name: 'SimplyApply', siteUrl: 'simplyappl.ai', fromEnvVar: 'OUTREACH_FROM_EMAIL_SIMPLYAPPLY', replyToEnvVar: 'OUTREACH_REPLYTO_EMAIL_SIMPLYAPPLY' },
  scribeai: { name: 'Scribe AI', siteUrl: 'scribeai.online', fromEnvVar: 'OUTREACH_FROM_EMAIL_SCRIBEAI', replyToEnvVar: 'OUTREACH_REPLYTO_EMAIL_SCRIBEAI' },
  meetingmind: { name: 'Meeting Mind', siteUrl: 'meetingmind.org', fromEnvVar: 'OUTREACH_FROM_EMAIL_MEETINGMIND', replyToEnvVar: 'OUTREACH_REPLYTO_EMAIL_MEETINGMIND' },
  vibebuild: { name: 'VibeBuild', siteUrl: 'vibebuild.cc', fromEnvVar: 'OUTREACH_FROM_EMAIL_VIBEBUILD', replyToEnvVar: 'OUTREACH_REPLYTO_EMAIL_VIBEBUILD' },
  voxkey: { name: 'VoxKey', siteUrl: 'kreativekoala.llc', fromEnvVar: 'OUTREACH_FROM_EMAIL_VOXKEY', replyToEnvVar: 'OUTREACH_REPLYTO_EMAIL_VOXKEY' },
  pixora: { name: 'Pixora', siteUrl: 'kreativekoala.llc', fromEnvVar: 'OUTREACH_FROM_EMAIL_PIXORA', replyToEnvVar: 'OUTREACH_REPLYTO_EMAIL_PIXORA' },
  gymlog: { name: 'GymLog', siteUrl: 'kreativekoala.llc', fromEnvVar: 'OUTREACH_FROM_EMAIL_GYMLOG', replyToEnvVar: 'OUTREACH_REPLYTO_EMAIL_GYMLOG' },
};
// Fallback for any Kreative Koala product key not yet in the map above.
const KREATIVE_KOALA_BRAND: Brand = { name: 'Kreative Koala LLC', siteUrl: 'kreativekoala.llc', fromEnvVar: 'OUTREACH_FROM_EMAIL_KK', postalEnvVar: KK_POSTAL_ENV, capEnvVar: KK_CAP_ENV, replyToEnvVar: 'OUTREACH_REPLYTO_EMAIL_KK' };

export function brandFor(product: string): Brand {
  if (!product.startsWith('kreativekoala')) return CALLDESK_BRAND;
  const key = product.split(':')[1];
  const appBrand = key && KK_APP_BRANDS[key];
  if (!appBrand) return KREATIVE_KOALA_BRAND;
  return { ...appBrand, postalEnvVar: KK_POSTAL_ENV, capEnvVar: KK_CAP_ENV };
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


export function buildFooter(email: string, postalAddress: string, brand: Brand = CALLDESK_BRAND): { text: string; html: string } {
  const link = unsubscribeUrl(email);
  const text = `\n\n--\n${brand.name} (${brand.siteUrl})\n${postalAddress}\nYou're receiving this because your business contact address is publicly listed. Not interested? Unsubscribe: ${link}`;
  const html =
    `<p style="color:#6b7280;font-size:12px;margin-top:24px">${escapeHtml(brand.name)} (${brand.siteUrl})<br/>` +
    `${escapeHtml(postalAddress)}<br/>You're receiving this because your business contact address is publicly listed. Not interested? <a href="${link}">Unsubscribe</a></p>`;
  return { text, html };
}

export type SendOutcome = { ok: true; resendId?: string } | { ok: false; error: string };

/** Renders exactly what will be sent for a message (also used by the admin preview, so they cannot drift). Never writes. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function buildOutreachEmail(
  supabase: SupabaseClient<any>,
  msg: any,
  ctx: { toEmail: string; product: string; brand: Brand; postalAddress: string },
): Promise<{ html: string; text: string; variant: 'plain' | 'sample' | undefined; sampleId: string | null }> {
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const { toEmail, product, brand, postalAddress } = ctx;
  const footer = buildFooter(toEmail, postalAddress, brand);
  let emailSample: EmailSample | undefined;
  let variant: 'plain' | 'sample' | undefined;
  let sampleId: string | null = null;
  try {
    const found = product.startsWith('calldesk:') && productSlug(product)
      ? await getPublishedSample(supabase, product) : null;
    if (found) {
      variant = pickVariant(String(msg.id));
      if (variant === 'sample') {
        const lines = snippetLines(found);
        if (lines.length > 0) {
          const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');
          const secs = found.audio_duration_sec;
          emailSample = {
            title: found.title || 'Sample call',
            durationLabel: secs && secs > 0 ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}` : undefined,
            lines,
            url: sampleUrl(base, product, sampleTokenFor(String(msg.id))),
            disclosure: found.disclosure || 'AI test caller talking to a Calldesk demo agent for a fictional business',
          };
          sampleId = found.id;
        }
      }
    }
  } catch (err) {
    console.warn('[outreach/sender] sample rendering failed; sending without sample:', err instanceof Error ? err.message : err);
    emailSample = undefined;
    sampleId = null;
  }
  if (variant === 'sample' && !emailSample) variant = 'plain';
  const { html, text } = renderOutreachEmail({ bodyText: String(msg.body_text), footer, sample: emailSample, site: { label: brand.siteUrl, url: /^https?:\/\//.test(brand.siteUrl) ? brand.siteUrl : `https://${brand.siteUrl}` } });
  return { html, text, variant, sampleId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendApprovedMessage(supabase: SupabaseClient<any>, messageId: string): Promise<SendOutcome> {
  const { data: msg, error } = await supabase.from('calldesk_outreach_messages').select('*').eq('id', messageId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!msg) return { ok: false, error: 'Message not found' };
  if (msg.status !== 'approved' && msg.status !== 'draft') return { ok: false, error: `Message is "${msg.status}", only draft or approved messages can be sent` };

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

  const { html, text, variant, sampleId } = await buildOutreachEmail(supabase, msg, { toEmail, product, brand, postalAddress });

  const replyTo = (brand.replyToEnvVar && process.env[brand.replyToEnvVar]) || from.match(/<(.+)>/)?.[1] || from;
  const result = await sendEmail({
    to: toEmail,
    subject: msg.subject,
    html,
    text,
    from,
    replyTo,
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
  if (variant) {
    try {
      const { error: vErr } = await supabase.from('calldesk_outreach_messages').update({ variant, sample_id: sampleId }).eq('id', messageId);
      if (vErr) console.warn('[outreach/sender] could not record variant:', vErr.message);
    } catch (err) {
      console.warn('[outreach/sender] could not record variant:', err instanceof Error ? err.message : err);
    }
  }
  await supabase.from('calldesk_outreach_leads').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', msg.lead_id);
  return { ok: true, resendId: result.id };
}
