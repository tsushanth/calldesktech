// Sample line-type lookup: pulls N random outreach leads with a phone, asks Telnyx
// Number Lookup for carrier/line type, and prints a summary. Read-only: writes nothing
// to the database. Results go to a JSON file so the full run can reuse them.
//
//   node --env-file=.env scripts/line-type-sample.mjs [N=200] [out=line-type-sample.json]
import { writeFileSync } from 'node:fs'

const N = Number(process.argv[2] || 200)
const OUT = process.argv[3] || 'line-type-sample.json'
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TELNYX = process.env.TELNYX_API_KEY
if (!SB || !SB_KEY || !TELNYX) throw new Error('missing SUPABASE or TELNYX env vars')

const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' }
const filter = 'phone=not.is.null&phone=neq.'

async function countLeads() {
  const r = await fetch(`${SB}/rest/v1/calldesk_outreach_leads?select=id&${filter}&limit=1`, { headers: sbHeaders })
  return Number(r.headers.get('content-range').split('/')[1])
}

async function leadAt(offset) {
  const r = await fetch(
    `${SB}/rest/v1/calldesk_outreach_leads?select=id,phone,product&${filter}&order=id&limit=1&offset=${offset}`,
    { headers: sbHeaders },
  )
  return (await r.json())[0]
}

function toE164(raw) {
  const d = String(raw).replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

async function lookup(e164) {
  const r = await fetch(`https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}?type=carrier`, {
    headers: { Authorization: `Bearer ${TELNYX}` },
  })
  if (r.status === 429) {
    await new Promise((res) => setTimeout(res, 1500))
    return lookup(e164)
  }
  if (!r.ok) return { error: r.status }
  const d = (await r.json()).data || {}
  return { line_type: d.carrier?.type || null, carrier: d.carrier?.name || null, valid: d.valid_number ?? null }
}

const total = await countLeads()
const offsets = new Set()
while (offsets.size < Math.min(N, total)) offsets.add(Math.floor(Math.random() * total))
const leads = []
for (const o of offsets) {
  const l = await leadAt(o)
  if (l) leads.push(l)
}

const results = []
for (const l of leads) {
  const e164 = toE164(l.phone)
  if (!e164) {
    results.push({ ...l, e164: null, line_type: 'bad_format' })
    continue
  }
  results.push({ ...l, e164, ...(await lookup(e164)) })
}

writeFileSync(OUT, JSON.stringify(results, null, 2))

const tally = {}
for (const r of results) {
  const k = r.error ? `error_${r.error}` : r.valid === false ? 'invalid' : r.line_type || 'unknown'
  tally[k] = (tally[k] || 0) + 1
}
console.log(`leads with phone: ${total}; sampled: ${results.length}`)
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(18)} ${String(v).padStart(4)}  ${((v / results.length) * 100).toFixed(1)}%`)
}
