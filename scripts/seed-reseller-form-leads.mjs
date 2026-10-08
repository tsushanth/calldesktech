// Puts reseller/agency leads that have a contact form into the admin Forms tab (signals.formOutreach, status 'ready'),
// so a human can open each form, paste the message and mark it done. Never submits anything.
// Usage: node scripts/seed-reseller-form-leads.mjs <contacted.csv> [--apply]
// The CSV (private, not in git) needs: lead_id, form_url, form_type (plain|captcha|embedded), emailed, calls, flag.
// Writes a rollback file of the previous signals next to the CSV when applying.
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const api = (p, init) => fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + p, { headers: H, ...init }).then((r) => r.json());
const csvPath = process.argv[2]; const apply = process.argv.includes('--apply');
function parse(t) { const rows = []; let r = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; } else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else f += c; } if (f || r.length) { r.push(f); rows.push(r); } return rows; }
const [h, ...rs] = parse(fs.readFileSync(csvPath, 'utf8'));
const csv = rs.filter((r) => r.length >= h.length).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));

// The message already used for the first reseller form submissions.
const ref = (await api("calldesk_outreach_leads?select=signals&product=eq.calldesk&signals->formOutreach->>status=eq.submitted&limit=1"))[0]?.signals?.formOutreach;
if (!ref?.body) throw new Error('reference message not found');
const base = { subject: ref.subject, body: ref.body, status: 'ready' };

const plan = [];
const fromCsv = csv.filter((r) => r.lead_id && r.form_url && !r.flag);
const ids = fromCsv.map((r) => r.lead_id);
const rows = ids.length ? await api('calldesk_outreach_leads?select=id,company_name,domain,signals,replied_at&id=in.(' + ids.join(',') + ')') : [];
const byId = new Map(rows.map((r) => [r.id, r]));
for (const c of fromCsv) {
  const l = byId.get(c.lead_id);
  if (!l || l.signals?.formOutreach || l.replied_at) continue;
  const bits = [c.emailed && 'already emailed', c.calls && c.calls].filter(Boolean);
  const cf = l.signals?.contactForm ?? { pageUrl: c.form_url, captcha: c.form_type === 'captcha', method: 'manual', fields: [] };
  plan.push({ l, cf, fo: { ...base, ...(bits.length ? { note: bits.join(', ') } : {}) } });
}
// form_only reseller leads with a form on file but no draft yet
const fo = await api("calldesk_outreach_leads?select=id,company_name,domain,signals,replied_at&product=eq.calldesk&contact_status=eq.form_only&limit=500");
for (const l of fo) { if (l.signals?.formOutreach || !l.signals?.contactForm?.pageUrl || l.replied_at) continue; plan.push({ l, cf: l.signals.contactForm, fo: { ...base } }); }

console.log(apply ? 'APPLY' : 'DRY RUN', plan.length, 'leads;', plan.filter((p) => p.cf.captcha).length, 'captcha;', plan.filter((p) => p.fo.note).length, 'with note');
if (!apply) process.exit(0);
fs.writeFileSync(csvPath.replace(/\.csv$/, '') + '-seed-rollback.json', JSON.stringify(plan.map((p) => ({ id: p.l.id, signals: p.l.signals })), null, 1));
let ok = 0;
for (const p of plan) {
  const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/calldesk_outreach_leads?id=eq.' + p.l.id, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ signals: { ...p.l.signals, contactForm: p.cf, formOutreach: p.fo }, updated_at: new Date().toISOString() }) });
  if (res.ok) ok++; else console.log('fail', p.l.id, res.status);
}
console.log('updated', ok);
