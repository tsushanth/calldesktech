// Cloudflare Email Worker, bound as the routing action on every zone that
// sends Calldesk/Kreative Koala outreach: calldesk.tech, kreativekoala.llc,
// simplyappl.ai, scribeai.online, meetingmind.org, vibebuild.cc.
//
// On every incoming email (a reply to one of our outreach addresses, or
// anything else sent to these domains): tell calldesk-tech's webhook who it's
// from, so it can mark the matching lead as replied and stop any further
// follow-up — then ALWAYS forward the message on to Gmail exactly as before.
// The webhook call is best-effort and never blocks or breaks delivery: a
// webhook failure (calldesk-tech down, network blip) still forwards the mail.

const WEBHOOK_URL = 'https://calldesk-tech.fly.dev/api/webhooks/inbound-reply';
const FORWARD_TO = 't.sushanth@gmail.com';

export default {
  async email(message, env, ctx) {
    ctx.waitUntil(
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.WEBHOOK_SECRET}` },
        body: JSON.stringify({ email: message.from }),
      }).catch(() => {}), // never let a webhook failure show up anywhere or block forwarding
    );
    await message.forward(FORWARD_TO);
  },
};
