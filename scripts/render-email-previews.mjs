// Renders docs/outreach-email-previews/*.html from fixtures. Run:
//   npx tsx scripts/render-email-previews.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderOutreachEmail } from '../src/lib/outreach/emailHtml.ts';

const footer = {
  text: '',
  html:
    '<p style="color:#6b7280;font-size:12px;margin-top:24px">Calldesk (calldesk.tech)<br/>123 Example St, Suite 4, City, ST 00000<br/>' +
    "You're receiving this because your business contact address is published on your website. Not interested? <a href=\"https://calldesk.tech/unsubscribe/example\">Unsubscribe</a></p>",
};
const disclosure = 'AI test caller talking to a Calldesk demo agent for a fictional business';
const fixtures = {
  plain: { bodyText: 'Hi,\n\nI am researching how freight brokers handle after-hours carrier calls. When a carrier calls at 9pm asking about a load, what happens today - voicemail, on-call dispatcher, something else?\n\nA one-line reply would help a lot. No pitch.\n\nThanks,\nSush' },
  'sample-freight': {
    bodyText: 'Hi,\n\nI am researching how freight brokers handle after-hours carrier calls. When a carrier calls at 9pm asking about a load, what happens today?\n\nWe recorded an AI test caller talking to our demo agent, in case it is useful context. A one-line reply would help a lot.\n\nThanks,\nSush',
    sample: { title: 'Freight broker after-hours load inquiry', durationLabel: '1:32', disclosure, url: 'https://calldesk.tech/samples/freight?t=EXAMPLE',
      lines: [
        { speaker: 'caller', text: 'Hi, calling about the Dallas to Atlanta load posted this afternoon. Is it still open?' },
        { speaker: 'agent', text: 'Thanks for calling Lone Star Freight. Yes, that load is still available. Can I get your MC number?' },
        { speaker: 'caller', text: 'MC 482913. Rate says 2,150 - any flexibility?' },
        { speaker: 'agent', text: 'I will note your request and have a broker call you first thing at 7am. Best number to reach you?' },
      ] },
  },
  'sample-dental': {
    bodyText: 'Hi,\n\nI am researching how dental offices handle calls that come in when the front desk is busy or closed. What happens to those calls today?\n\nWe recorded an AI test caller talking to our demo agent, in case it is useful context. A one-line reply would help a lot.\n\nThanks,\nSush',
    sample: { title: 'Dental office new-patient call', durationLabel: '1:18', disclosure, url: 'https://calldesk.tech/samples/dental?t=EXAMPLE',
      lines: [
        { speaker: 'caller', text: 'Hi, I would like to book a cleaning. Are you taking new patients?' },
        { speaker: 'agent', text: 'Yes, we are. I can offer Thursday at 10:30 or Friday at 2:00. Which works better?' },
        { speaker: 'caller', text: 'Friday at 2 is good. Do you take Delta Dental?' },
        { speaker: 'agent', text: 'We do. I have you down for Friday at 2:00 and will text a confirmation.' },
        { speaker: 'caller', text: 'Great, thanks.' },
      ] },
  },
};
mkdirSync('docs/outreach-email-previews', { recursive: true });
for (const [name, f] of Object.entries(fixtures)) {
  const { html } = renderOutreachEmail({ ...f, footer });
  writeFileSync(`docs/outreach-email-previews/${name}.html`,
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head><body style="margin:0;padding:24px;background:#f4f5f7">` +
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;padding:24px">${html}</div></body></html>\n`);
}
console.log('wrote previews');
