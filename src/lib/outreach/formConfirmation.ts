// Confirms a contact-form submission from the receiving company's own auto-reply. Many forms show no on-page proof (the worker then records
// 'needs_manual / unconfirmed'), but the company emails an acknowledgement to the address we submitted with (outreach@), which Cloudflare Email
// Routing hands to /api/webhooks/inbound-reply. A mail from the lead's own domain, after the attempt, is proof the form arrived.
//
// Pure functions here; the webhook route does the reads and writes.

export interface ConfirmLead {
  id: string;
  domain: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signals: any;
}

export interface InboundMail {
  from: string; // envelope sender, may be a bounce address
  fromHeader?: string | null; // the From header ("Name <a@b.com>"), usually the company's own address
  subject?: string | null;
  receivedAt: Date;
}

/** "Name <a@b.com>" or "a@b.com" -> "a@b.com" (lower-case), or '' when there is no address. */
export function addressOf(raw: string | null | undefined): string {
  const s = String(raw || '').trim();
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(s) || /([^\s<>"',;]+@[^\s<>"',;]+)/.exec(s);
  return m ? m[1].toLowerCase() : '';
}

export function hostOf(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const host = address.slice(at + 1).trim().toLowerCase().replace(/^www\./, '').replace(/[>\s]+$/, '');
  return host.includes('.') ? host : null;
}

/** Same site: equal, or one is a subdomain of the other (mail.getstream.io vs getstream.io, agents.bubblyphone.com vs bubblyphone.com). */
export function hostsRelated(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a || '').toLowerCase().replace(/^www\./, '');
  const y = (b || '').toLowerCase().replace(/^www\./, '');
  if (!x.includes('.') || !y.includes('.')) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

const MAX_AGE_MS = 72 * 3600 * 1000; // an acknowledgement is not expected days later
const SLACK_MS = 2 * 60 * 1000; // clocks and queueing: accept a mail a little before the recorded attempt time

/** The leads whose last attempt was 'unconfirmed' and for which this mail is the acknowledgement. */
export function confirmableLeads(leads: ConfirmLead[], mail: InboundMail): ConfirmLead[] {
  const hosts = [mail.from, mail.fromHeader || ''].map((a) => hostOf(addressOf(a))).filter((h): h is string => !!h);
  if (!hosts.length) return [];
  const t = mail.receivedAt.getTime();
  return leads.filter((l) => {
    const fo = l.signals?.formOutreach;
    if (!fo || fo.status !== 'needs_manual') return false;
    const last = Array.isArray(fo.attempts) ? fo.attempts[fo.attempts.length - 1] : null;
    if (!last || last.outcome !== 'needs_manual' || !String(last.reason || '').startsWith('unconfirmed')) return false;
    const at = Date.parse(last.at);
    if (!Number.isFinite(at) || t < at - SLACK_MS || t - at > MAX_AGE_MS) return false;
    return hosts.some((h) => hostsRelated(l.domain, h));
  });
}

/** The lead's formOutreach after the acknowledgement: submitted, with the mail as evidence. Keeps the attempts history and adds one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function confirmedOutreach(fo: any, mail: InboundMail): any {
  const sender = addressOf(mail.fromHeader) || addressOf(mail.from);
  const subject = String(mail.subject || '').replace(/\s+/g, ' ').slice(0, 120);
  const at = mail.receivedAt.toISOString();
  return {
    ...fo,
    status: 'submitted',
    submittedAt: at,
    confirmedBy: `auto-reply email from ${sender} at ${at}${subject ? ` ("${subject}")` : ''}; the page showed no proof`,
    attempts: [...(fo.attempts || []), { at, outcome: 'submitted', reason: 'confirmed by the company\'s auto-reply email' }],
  };
}
