// Renders the outreach email (html + text alternative). Without a sample the
// output is byte-for-byte what sender.ts historically built; with a sample a
// compact table-based transcript card is inserted between body and footer.

import { withUtm, type UtmContext } from './utm';

export interface EmailSample {
  title: string;
  durationLabel?: string;
  lines: { speaker: 'caller' | 'agent'; text: string }[];
  url: string;
  disclosure: string;
  // Optional link to the hosted pitch deck, shown under the sample-call button.
  deckUrl?: string;
}

export interface RenderInput {
  bodyText: string;
  footer: { text: string; html: string };
  sample?: EmailSample | null;
  // Clickable link to the sender's website, shown at the very top of the email.
  site?: { label: string; url: string } | null;
  // Link to the product's hosted pitch deck. Shown even when there is no sample card
  // (sample.deckUrl still wins when both are set, so it stays inside the card).
  deckUrl?: string | null;
  // Link to the /try trial-coupon form (signed per-message token). Optional; omitted for products without a coupon offer.
  tryUrl?: string | null;
  // When set, every link above (sample, deck, site) is UTM-tagged by the one helper in utm.ts, in both the
  // HTML and the text alternative. The footer (unsubscribe) is never tagged. Unset = links untouched.
  utm?: UtmContext;
  // v2 layout (app and ReadAloud emails): brand header band, bullets, linked URLs and one call-to-action button placed before the sign-off.
  // Without `v2` the output is exactly what it always was.
  v2?: { brand: string; color?: string; cta?: { label: string; url: string } | null };
}

const CARD_MAX_LINES = 6;
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderCard(sample: EmailSample, lines: EmailSample['lines']): string {
  const label = ['Sample call', sample.durationLabel, 'AI demo'].filter(Boolean).map((s) => escapeHtml(s as string)).join(' &middot; ');
  const rows = lines
    .map((l) => {
      const isCaller = l.speaker === 'caller';
      const bg = isCaller ? '#eef1f6' : '#e3f0ff';
      const who = isCaller ? 'CALLER' : 'AGENT';
      const align = isCaller ? 'left' : 'right';
      return (
        `<tr><td align="${align}" style="padding:0 0 8px">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="max-width:88%"><tr>` +
        `<td style="background-color:${bg};color:#1a1d29;border-radius:8px;padding:8px 12px;font-family:${FONT};font-size:14px;line-height:1.45;text-align:left">` +
        `<span style="font-size:10px;font-weight:bold;letter-spacing:0.06em;color:#4b5563">${who}</span><br/>${escapeHtml(l.text)}` +
        `</td></tr></table></td></tr>`
      );
    })
    .join('');
  const url = escapeAttr(sample.url);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:8px 0 14px"><tr>` +
    `<td style="background-color:#ffffff;color:#1a1d29;border:1px solid #d9dee7;border-radius:10px;padding:14px;font-family:${FONT}">` +
    `<p style="margin:0 0 10px;font-size:12px;font-weight:bold;color:#4b5563;letter-spacing:0.02em">${label}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 10px"><tr>` +
    `<td bgcolor="#1a1d29" style="background-color:#1a1d29;border-radius:6px;padding:10px 18px">` +
    `<a href="${url}" style="font-family:${FONT};font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;display:inline-block">Listen to the full sample call</a>` +
    `</td></tr></table>` +
    (sample.deckUrl ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.4;color:#4b5563">Prefer to read? <a href="${escapeAttr(sample.deckUrl)}" style="color:#2563eb">See our short deck</a>.</p>` : '') +
    `<p style="margin:0;font-size:11px;line-height:1.4;color:#6b7280">${escapeHtml(sample.disclosure)}</p>` +
    `</td></tr></table>`
  );
}

function tagLinks(input: RenderInput): RenderInput {
  const utm = input.utm;
  if (!utm) return input;
  const tag = (u: string) => withUtm(u, utm);
  return {
    ...input,
    sample: input.sample ? { ...input.sample, url: tag(input.sample.url), deckUrl: input.sample.deckUrl ? tag(input.sample.deckUrl) : input.sample.deckUrl } : input.sample,
    deckUrl: input.deckUrl ? tag(input.deckUrl) : input.deckUrl,
    tryUrl: input.tryUrl ? tag(input.tryUrl) : input.tryUrl,
    site: input.site ? { ...input.site, url: tag(input.site.url) } : input.site,
    v2: input.v2 ? { ...input.v2, cta: input.v2.cta ? { ...input.v2.cta, url: tag(input.v2.cta.url) } : input.v2.cta } : input.v2,
  };
}

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g;
function linkify(escaped: string): string {
  return escaped.replace(URL_RE, (u) => `<a href="${u}" style="color:#2563eb">${u}</a>`);
}

// Splits the body into paragraphs and "- " bullet groups; the CTA button goes before a short final sign-off paragraph.
function v2Body(bodyText: string, cta: { label: string; url: string } | null | undefined, color: string): string {
  const blocks = String(bodyText).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const isSignoff = (b: string) => b.split('\n').length <= 3 && /(sushanth|deepika|co-?founder|thanks|best regards)/i.test(b);
  const render = (b: string) => {
    const lines = b.split('\n');
    if (lines.length > 1 && lines.every((l) => /^\s*[-*\u2022]\s+/.test(l))) {
      return `<ul style="margin:0 0 14px;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 6px">${linkify(escapeHtml(l.replace(/^\s*[-*\u2022]\s+/, '')))}</li>`).join('')}</ul>`;
    }
    return `<p style="margin:0 0 14px">${linkify(escapeHtml(b)).replace(/\n/g, '<br/>')}</p>`;
  };
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px"><tr><td bgcolor="${color}" style="background-color:${color};border-radius:6px;padding:11px 20px"><a href="${escapeAttr(cta.url)}" style="font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;display:inline-block">${escapeHtml(cta.label)}</a></td></tr></table>`
    : '';
  const last = blocks[blocks.length - 1];
  if (blocks.length > 1 && isSignoff(last)) return blocks.slice(0, -1).map(render).join('') + button + render(last);
  return blocks.map(render).join('') + button;
}

export function renderOutreachEmail(rawInput: RenderInput): { html: string; text: string } {
  const input = tagLinks(rawInput);
  const { bodyText, footer, sample, site } = input;
  const v2 = input.v2;
  const v2Color = v2?.color || '#1a1d29';
  const paragraphs = v2
    ? v2Body(bodyText, v2.cta, v2Color)
    : String(bodyText)
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
        .join('');
  const lines = sample ? sample.lines.slice(0, CARD_MAX_LINES) : [];
  const card = sample && lines.length > 0 ? renderCard(sample, lines) : '';
  const standaloneDeckUrl = input.deckUrl && !(sample && lines.length > 0 && sample.deckUrl) ? input.deckUrl : null;
  const deckHtml = standaloneDeckUrl
    ? `<p style="margin:0 0 14px;font-size:13px;color:#4b5563">Prefer to read? <a href="${escapeAttr(standaloneDeckUrl)}" style="color:#2563eb">See our short deck</a>.</p>`
    : '';
  const tryHtml = input.tryUrl
    ? `<p style="margin:0 0 14px;font-size:13px;color:#4b5563">Want to try it? <a href="${escapeAttr(input.tryUrl)}" style="color:#2563eb">Get a trial coupon</a>.</p>`
    : '';
  const headerHtml = v2
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px"><tr><td style="border-bottom:3px solid ${v2Color};padding:0 0 8px;font-family:${FONT};font-size:16px;font-weight:bold;color:#1a1d29">${escapeHtml(v2.brand)}</td></tr></table>`
    : '';
  const siteHtml = !v2 && site ? `<p style="margin:0 0 18px"><a href="${escapeAttr(site.url)}" style="color:#2563eb;font-weight:600;text-decoration:none">${escapeHtml(site.label)}</a></p>` : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1d29;max-width:560px">${headerHtml}${siteHtml}${paragraphs}${card}${deckHtml}${tryHtml}${footer.html}</div>`;

  let textSample = '';
  const deckText = standaloneDeckUrl ? `\nShort deck: ${standaloneDeckUrl}\n` : '';
  if (sample && lines.length > 0) {
    const head = ['Sample call', sample.durationLabel, 'AI demo'].filter(Boolean).join(' · ');
    const body = lines.map((l) => `${l.speaker === 'caller' ? 'Caller' : 'Agent'}: ${l.text}`).join('\n');
    textSample = `\n\n${head} - ${sample.title}\n${body}\nListen to the full sample call: ${sample.url}${sample.deckUrl ? `\nShort deck: ${sample.deckUrl}` : ''}\n${sample.disclosure}`;
  }
  const tryText = input.tryUrl ? `\nTrial coupon: ${input.tryUrl}\n` : '';
  const siteText = site ? `${site.url}\n\n` : '';
  const ctaText = v2?.cta ? `\n${v2.cta.label}: ${v2.cta.url}\n` : '';
  return { html, text: `${v2 ? '' : siteText}${bodyText}${ctaText}${textSample}${deckText}${tryText}${footer.text}` };
}
