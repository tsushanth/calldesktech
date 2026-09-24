// Renders the outreach email (html + text alternative). Without a sample the
// output is byte-for-byte what sender.ts historically built; with a sample a
// compact table-based transcript card is inserted between body and footer.

export interface EmailSample {
  title: string;
  durationLabel?: string;
  lines: { speaker: 'caller' | 'agent'; text: string }[];
  url: string;
  disclosure: string;
}

export interface RenderInput {
  bodyText: string;
  footer: { text: string; html: string };
  sample?: EmailSample | null;
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
    `<p style="margin:0;font-size:11px;line-height:1.4;color:#6b7280">${escapeHtml(sample.disclosure)}</p>` +
    `</td></tr></table>`
  );
}

export function renderOutreachEmail(input: RenderInput): { html: string; text: string } {
  const { bodyText, footer, sample } = input;
  const paragraphs = String(bodyText)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  const lines = sample ? sample.lines.slice(0, CARD_MAX_LINES) : [];
  const card = sample && lines.length > 0 ? renderCard(sample, lines) : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1d29;max-width:560px">${paragraphs}${card}${footer.html}</div>`;

  let textSample = '';
  if (sample && lines.length > 0) {
    const head = ['Sample call', sample.durationLabel, 'AI demo'].filter(Boolean).join(' · ');
    const body = lines.map((l) => `${l.speaker === 'caller' ? 'Caller' : 'Agent'}: ${l.text}`).join('\n');
    textSample = `\n\n${head} - ${sample.title}\n${body}\nListen to the full sample call: ${sample.url}\n${sample.disclosure}`;
  }
  return { html, text: `${bodyText}${textSample}${footer.text}` };
}
