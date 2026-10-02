// Looks up carrier line type (Telnyx Number Lookup) for the phones of a set of outreach leads and stores the
// result per E.164 phone in calldesk_phone_lookups, skipping phones already looked up. Costs a fraction of a
// cent per lookup. Run:
//
//   node --env-file=.env scripts/lookup-line-types.mjs                       # freight FMCSA leads (default)
//   PRODUCT=calldesk:insurance LIMIT=300 node --env-file=.env scripts/lookup-line-types.mjs
//
// PRODUCT   leads.product to look up (default calldesk:freight)
// SOURCE    optional source_key prefix filter (default 'freight:mc:' for freight, none otherwise)
// LIMIT     max phones to look up this run (default all)
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELNYX = process.env.TELNYX_API_KEY;
if (!SB || !KEY || !TELNYX) throw new Error('missing SUPABASE or TELNYX env vars');
const PRODUCT = process.env.PRODUCT || 'calldesk:freight';
const SOURCE = process.env.SOURCE ?? (PRODUCT === 'calldesk:freight' ? 'freight:mc:' : '');
const LIMIT = Number(process.env.LIMIT) || Infinity;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const norm = (raw) => {
  const d = String(raw ?? '').replace(/\D/g, '');
  const e = d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : null;
  return e && /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e) ? e : null;
};

async function rest(path, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

const phones = new Set();
for (let off = 0; ; off += 1000) {
  const src = SOURCE ? `&source_key=like.${encodeURIComponent(SOURCE)}*` : '';
  const rows = await rest(`calldesk_outreach_leads?select=phone&product=eq.${encodeURIComponent(PRODUCT)}&phone=not.is.null${src}&order=id&limit=1000&offset=${off}`);
  for (const r of rows) { const e = norm(r.phone); if (e) phones.add(e); }
  if (rows.length < 1000) break;
}
const done = new Set((await rest('calldesk_phone_lookups?select=phone&limit=100000')).map((r) => r.phone));
const todo = [...phones].filter((p) => !done.has(p)).slice(0, LIMIT);
console.log(`${PRODUCT}: ${phones.size} valid phones, ${done.size} already looked up overall, ${todo.length} to look up now`);

async function lookup(e164) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}?type=carrier`, { headers: { Authorization: `Bearer ${TELNYX}` } });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); continue; }
    if (!r.ok) return { phone: e164, error: r.status };
    const d = (await r.json()).data || {};
    return { phone: e164, line_type: d.carrier?.type || null, carrier: d.carrier?.name || null, valid: d.valid_number ?? null };
  }
  return { phone: e164, error: 429 };
}

const results = [];
const CONC = 5;
for (let i = 0; i < todo.length; i += CONC) {
  results.push(...(await Promise.all(todo.slice(i, i + CONC).map(lookup))));
  if ((i / CONC) % 10 === 9) console.log(`  ${Math.min(i + CONC, todo.length)}/${todo.length}`);
}
import('node:fs').then((fs) => fs.writeFileSync(`lookup-${PRODUCT.replace(/[^a-z]/gi, '-')}-${Date.now()}.json`, JSON.stringify(results)));
const good = results.filter((r) => !r.error);
const failed = results.filter((r) => r.error);
for (let i = 0; i < good.length; i += 200) {
  await rest('calldesk_phone_lookups?on_conflict=phone', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(good.slice(i, i + 200)) });
}
const tally = {};
for (const r of good) { const k = r.valid === false ? 'invalid' : r.line_type || 'unknown'; tally[k] = (tally[k] || 0) + 1; }
console.log(`stored ${good.length}, failed ${failed.length}`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${String(v).padStart(4)}  ${((v / good.length) * 100).toFixed(1)}%`);
