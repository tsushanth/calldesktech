import { unsubscribeUrl } from './unsubscribe';

// A short, formatted follow-up for a prospect or partner who asked for details on a call. Two shapes:
//   partner: agencies and platforms (Calldesk platform + partner terms, optionally the ReadAloud speech API)
//   direct:  a business that wants Calldesk answering its own calls
// Only facts from the reseller call script and the public deck are used (prices, the 20% share, free trial). Output is
// ASCII-only text plus a table-based HTML version, so it reads the same in any mail client.

export type ProposalKind = 'partner' | 'direct';

export interface ProposalInput {
  kind: ProposalKind;
  firstName?: string;
  /** One or two sentences tying the email to the call, e.g. "Thanks for taking our colleague Mark's call today." */
  context: string;
  /** Demo booking link. Without one, the email asks for two or three times instead. */
  bookingUrl?: string | null;
  /** Partner emails only: show the speech-API cost comparison. Default true. */
  includeSpeechApi?: boolean;
}

export interface RenderedProposal { text: string; html: string }

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DECK_URL = 'https://readaloudai.org/deck';
const PRICING_URL = 'https://calldesk.tech/pricing';
const PHONE = '425-628-4887';
const REPLY = 'outreach@calldesk.tech';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function bullets(kind: ProposalKind): string[] {
  if (kind === 'direct') {
    return [
      'Answers the calls you miss, day or night: after hours, or while you are out on a job.',
      'Plans from 2 cents a minute (Lite 2c, Standard 5c, Pro 9c), with the language model and voice included. Details at calldesk.tech/pricing.',
      'Free one-week trial, capped at 50 minutes of calls, no credit card. You forward your overflow or after-hours calls to a number we give you.',
    ];
  }
  return [
    'Inbound and outbound phone agents, a knowledge base and call analytics. 55 languages on live calls (the Lite voice is English only).',
    'From 2 cents a minute, with the language model and voice included (Lite 2c, Standard 5c, Pro 9c). No per-booking or per-transfer fees.',
    'Partners get a free trial, direct access to us, and a 20% revenue share on usage from customers they refer. Other terms are still being finalized with the first partners.',
  ];
}

export function renderProposal(input: ProposalInput, toEmail: string, postalAddress: string): RenderedProposal {
  const hi = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const items = bullets(input.kind);
  const speech = input.kind === 'partner' && input.includeSpeechApi !== false;
  const cta = input.bookingUrl
    ? 'Book a 15-minute demo'
    : 'Reply with two or three times that suit you (and your time zone) and we will send an invite';
  const unsub = unsubscribeUrl(toEmail);

  const text = [
    hi, '', input.context.trim(), '',
    input.kind === 'direct' ? 'Here is the short version of what Calldesk does for a business like yours:' : 'Here is the short version of Calldesk:',
    ...items.map((i) => `- ${i}`),
    ...(speech ? [
      '',
      'If you run your own voice stack, our readaloudai.org speech API is built for that: text-to-speech at $0.004 per 1,000 characters (standard voices) or $0.01 (expressive), and batch speech-to-text at $0.11 per hour, billed by the second. New accounts get free credit to try.',
      'Illustrative, at list prices, one call minute with 550 characters of agent speech: premium voice tier $0.0655, ReadAloud standard voices $0.0237.',
    ] : []),
    '',
    input.bookingUrl ? `Next step: book a 15-minute demo here: ${input.bookingUrl}` : `Next step: ${cta}.`,
    `The deck, if you prefer to read: ${DECK_URL}`,
    '',
    `You can also reach us at ${REPLY} or ${PHONE}.`, '',
    'Thanks,', 'The Calldesk team', '',
    '--', `Calldesk (calldesk.tech)`, postalAddress,
    `You're receiving this because you spoke with our team or asked for details. Not interested? Unsubscribe: ${unsub}`,
  ].join('\n');

  const li = items.map((i) => `<li style="margin:0 0 8px">${esc(i)}</li>`).join('');
  const bar = (label: string, value: string, pct: number, color: string) =>
    `<tr><td style="padding:2px 0 2px;font-size:13px;color:#374151">${esc(label)}</td><td align="right" style="padding:2px 0;font-size:13px;color:#111827;font-weight:bold">${esc(value)}</td></tr>` +
    `<tr><td colspan="2" style="padding:0 0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td width="${pct}%" height="10" style="background-color:${color};border-radius:5px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`;
  const speechHtml = speech
    ? `<p style="margin:16px 0 8px;font-size:14px;line-height:1.5;color:#1a1d29">If you run your own voice stack, our <b>readaloudai.org</b> speech API is built for that: text-to-speech at <b>$0.004</b> per 1,000 characters (standard) or $0.01 (expressive), and batch speech-to-text at <b>$0.11 per hour</b>, billed by the second. New accounts get free credit to try.</p>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#f6f8fb;border:1px solid #e1e6ee;border-radius:8px"><tr><td style="padding:12px 14px">` +
      `<p style="margin:0 0 8px;font-size:12px;font-weight:bold;color:#4b5563">Cost of one call minute, at list prices</p>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      bar('Premium voice tier', '$0.0655', 100, '#9ca3af') + bar('ReadAloud standard voices', '$0.0237', 36, '#2563eb') +
      `</table><p style="margin:0;font-size:11px;color:#6b7280">Illustrative: 550 characters of agent speech per minute; only the voice changes.</p></td></tr></table>`
    : '';
  const button = input.bookingUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px"><tr><td bgcolor="#1a1d29" style="background-color:#1a1d29;border-radius:6px;padding:11px 20px"><a href="${esc(input.bookingUrl)}" style="font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;display:inline-block">${esc(cta)}</a></td></tr></table>`
    : `<p style="margin:18px 0 6px;font-size:14px;line-height:1.5;color:#1a1d29"><b>Next step:</b> ${esc(cta)}.</p>`;
  const html =
    `<div style="font-family:${FONT};font-size:14px;line-height:1.5;color:#1a1d29;max-width:560px">` +
    `<p style="margin:0 0 10px">${esc(hi)}</p><p style="margin:0 0 10px">${esc(input.context.trim())}</p>` +
    `<p style="margin:0 0 6px">${esc(input.kind === 'direct' ? 'The short version of what Calldesk does for a business like yours:' : 'The short version of Calldesk:')}</p>` +
    `<ul style="margin:0 0 6px;padding-left:20px">${li}</ul>${speechHtml}${button}` +
    `<p style="margin:6px 0 14px;font-size:13px;color:#4b5563">Prefer to read? <a href="${DECK_URL}" style="color:#2563eb">See our short deck</a>${input.kind === 'direct' ? ` or <a href="${PRICING_URL}" style="color:#2563eb">the pricing page</a>` : ''}. You can also reach us at ${REPLY} or ${PHONE}.</p>` +
    `<p style="margin:0">Thanks,<br/>The Calldesk team</p>` +
    `<p style="color:#6b7280;font-size:12px;margin-top:22px">Calldesk (calldesk.tech)<br/>${esc(postalAddress)}<br/>You're receiving this because you spoke with our team or asked for details. Not interested? <a href="${esc(unsub)}">Unsubscribe</a></p></div>`;
  return { text, html };
}
