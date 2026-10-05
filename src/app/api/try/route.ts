import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { tryAcquireToken } from '@/lib/rateLimiter';
import { verifySampleToken } from '@/lib/outreach/samples';
import { CONSENT_TEXT, CONSENT_VERSION, COUPON_DAYS, COUPON_ID, FORM_COPY, consentSha256, formSha256, generateCouponCode, parseConsentBody, shownMatchesCurrent, smsStatusFor } from '@/lib/outreach/smsConsent';

export const dynamic = 'force-dynamic';

const IP_LIMIT = { capacity: 5, refillPerSec: 0.01 };
const GLOBAL_LIMIT = { capacity: 40, refillPerSec: 0.2 };

async function makeCoupon(): Promise<string | null> {
  try {
    const stripe = getStripe();
    try { await stripe.coupons.retrieve(COUPON_ID); } catch {
      await stripe.coupons.create({ id: COUPON_ID, amount_off: 1000, currency: 'usd', duration: 'once', name: '$10 signup credit (outreach)' });
    }
    const code = generateCouponCode((n) => new Uint8Array(randomBytes(n)));
    const promo = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: COUPON_ID }, code, max_redemptions: 1,
      expires_at: Math.floor(Date.now() / 1000) + COUPON_DAYS * 86400,
    });
    return promo.code;
  } catch (err) {
    console.error('[try] coupon creation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// POST /api/try { t, phone, smsOptIn, website }: records the person's phone and SMS marketing consent and returns their coupon.
// Public, but only reachable with the signed per-message token from our outreach email, rate limited, with a honeypot.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const parsed = parseConsentBody(body);
  if ('bot' in parsed) return NextResponse.json({ ok: true, coupon: null }); // silent success for bots
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  if (!shownMatchesCurrent(parsed.shownVersion, parsed.shownSha256)) {
    return NextResponse.json({ error: 'This page is out of date. Please reload it and try again.', stale: true }, { status: 409 });
  }

  const messageId = verifySampleToken(String(body.t ?? ''));
  if (!messageId) return NextResponse.json({ error: 'This link is not valid. Please use the link in your email.' }, { status: 400 });

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (!(await tryAcquireToken(`try:ip:${ip}`, IP_LIMIT)) || !(await tryAcquireToken('try:global', GLOBAL_LIMIT))) {
    return NextResponse.json({ error: 'Too many requests. Please try again in a few minutes.' }, { status: 429 });
  }

  const supabase = getSupabaseAdmin();
  const { data: msg } = await supabase.from('calldesk_outreach_messages').select('id, lead_id, product').eq('id', messageId).maybeSingle();
  if (!msg) return NextResponse.json({ error: 'This link is not valid. Please use the link in your email.' }, { status: 400 });

  const { data: optedOut } = await supabase.from('sms_opt_outs').select('phone_number').eq('phone_number', parsed.phone).maybeSingle();
  const smsStatus = smsStatusFor(parsed.smsOptIn, !!optedOut);

  const { data: existing } = await supabase.from('calldesk_sms_consents').select('coupon_code').eq('message_id', messageId).maybeSingle();
  const coupon = (existing?.coupon_code as string | null | undefined) || (await makeCoupon());

  const ua = (request.headers.get('user-agent') || '').slice(0, 300);
  const now = new Date().toISOString();

  // 1) The wording itself (immutable, one row per version). 2) The submission as an append-only event: exactly what was shown and what
  // was chosen. Both must succeed, otherwise we do not record a consent we cannot prove.
  const textRow = { version: CONSENT_VERSION, sha256: consentSha256(), consent_text: CONSENT_TEXT, form_copy: FORM_COPY };
  const { error: textErr } = await supabase.from('calldesk_sms_consent_texts').upsert(textRow, { onConflict: 'version', ignoreDuplicates: true });
  const { error: evErr } = textErr ? { error: textErr } : await supabase.from('calldesk_sms_consent_events').insert({
    message_id: messageId, lead_id: msg.lead_id ?? null, product: msg.product ?? null, phone: parsed.phone,
    sms_opt_in: parsed.smsOptIn, checkbox_default_checked: FORM_COPY.consentCheckboxDefaultChecked,
    consent_version: CONSENT_VERSION, consent_text: CONSENT_TEXT, consent_sha256: consentSha256(), form_copy: FORM_COPY, form_sha256: formSha256(),
    page_url: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '')}${FORM_COPY.page}`,
    referrer: (request.headers.get('referer') || '').slice(0, 500) || null, accept_language: (request.headers.get('accept-language') || '').slice(0, 100) || null,
    ip, user_agent: ua, coupon_code: coupon,
  });
  if (evErr) {
    console.error('[try] could not write the consent audit record:', evErr.message);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  const row = {
    message_id: messageId, lead_id: msg.lead_id ?? null, product: msg.product ?? null, phone: parsed.phone,
    sms_opt_in: parsed.smsOptIn, sms_status: smsStatus,
    consent_text: CONSENT_TEXT, consent_version: CONSENT_VERSION, consent_sha256: consentSha256(), // the wording shown, whether or not the box was ticked
    ip, user_agent: ua, coupon_code: coupon, updated_at: now,
  };
  const { error } = await supabase.from('calldesk_sms_consents').upsert(row, { onConflict: 'message_id' });
  if (error) {
    console.error('[try] could not update the current consent row:', error.message);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, coupon, smsOptIn: parsed.smsOptIn, suppressed: smsStatus === 'suppressed_stop_on_file' });
}
