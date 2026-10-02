// Creates (or replaces) the private link for each caller on the /caller page and the supervisor link for the admin.
// Only a SHA-256 hash of each token is stored, so the raw link is shown ONCE here and cannot be recovered later;
// re-run to replace a link (the old one stops working). Run:
//
//   node --env-file=.env scripts/issue-caller-links.mjs mary mark          # callers
//   ADMIN=sushanth node --env-file=.env scripts/issue-caller-links.mjs     # supervisor link for an existing row
import { createHash, randomBytes } from 'node:crypto';

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = (process.env.NEXT_PUBLIC_APP_URL || 'https://calldesk.tech').replace(/\/$/, '');
if (!SB || !KEY) throw new Error('missing SUPABASE env vars');

async function setToken(username, role) {
  const token = randomBytes(24).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const r = await fetch(`${SB}/rest/v1/calldesk_outbound_callers?sip_username=eq.${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ access_token_hash: hash, role }),
  });
  const rows = await r.json();
  if (!r.ok || !rows.length) throw new Error(`${username}: no such caller row (${r.status})`);
  const path = role === 'admin' ? '/caller/admin' : '/caller';
  console.log(`${username.padEnd(10)} ${role.padEnd(6)} ${BASE}${path}?k=${token}`);
}

const admin = process.env.ADMIN;
if (admin) await setToken(admin, 'admin');
for (const u of process.argv.slice(2)) await setToken(u, 'caller');
