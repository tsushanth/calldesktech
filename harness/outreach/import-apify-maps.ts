#!/usr/bin/env -S node --import tsx
// Imports Google Maps items scraped with Apify (compass/crawler-google-places) as US/Canada reseller leads.
//   ITEMS=/path/items.json DRY_RUN=1 tsx harness/outreach/import-apify-maps.ts
// Same relevance filter, dedupe-by-domain and lead shape as discover-resellers-maps.ts. Only US/CA leads are inserted (never held).
import { readFileSync, writeFileSync } from 'fs';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isPlatformDomain } from '@/lib/outreach/platformBlocklist';
import { isBlockedDomain } from '@/lib/outreach/discovery/score';
import { bareDomain } from './enrich-phones-maps';
import { relevantListing } from './discover-resellers-maps';

// Name misses the shared filter lets through: home/industrial automation, security, health, schools, app shops.
const EXTRA_BAD = /\b(home automation|automated (?:avi|security)|security|iot|industrial|spa|optical\w*|academy|learners|integrators|integration|advanced automation|american automation|fintech|apps?|mobile|creative automation|data solutions|hayden|apera|reality ai|jasper|iamecon|markovate|hatchworks|pr)\b|优视/i;

interface Item { placeId?: string; title?: string; phone?: string; phoneUnformatted?: string; website?: string; categoryName?: string; city?: string; state?: string; countryCode?: string; address?: string; permanentlyClosed?: boolean }

export function usCaPhone(i: Item): string | null {
  const d = String(i.phoneUnformatted || i.phone || '').replace(/\D/g, '');
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return n.length === 10 ? `+1${n}` : null;
}

async function main() {
  const DRY_RUN = process.env.DRY_RUN === '1';
  const items = JSON.parse(readFileSync(process.env.ITEMS as string, 'utf8')) as Item[];
  const cands = new Map<string, { name: string; domain: string; phone: string; cat: string; city: string; cc: string; key: string; address: string }>();
  for (const i of items) {
    const cc = i.countryCode === 'CA' ? 'CA' : i.countryCode === 'US' ? 'US' : null;
    const domain = bareDomain(i.website);
    const phone = usCaPhone(i);
    if (!cc || !domain || !phone || i.permanentlyClosed || cands.has(domain)) continue;
    if (!relevantListing(i.title, i.categoryName) || EXTRA_BAD.test(i.title ?? '') || isPlatformDomain(domain) || isBlockedDomain(domain)) continue;
    cands.set(domain, { name: i.title as string, domain, phone, cat: i.categoryName ?? '', city: [i.city, i.state].filter(Boolean).join(', '), cc, key: `calldesk:maps:${i.placeId || domain}`, address: i.address ?? '' });
  }
  const db = getSupabaseAdmin();
  const domains = [...cands.keys()], known = new Set<string>(), knownPhone = new Set<string>();
  for (let k = 0; k < domains.length; k += 100) {
    const { data } = await db.from('calldesk_outreach_leads').select('domain').eq('product', 'calldesk').in('domain', domains.slice(k, k + 100));
    for (const r of data ?? []) known.add(String(r.domain).toLowerCase());
  }
  const phones = [...cands.values()].map((c) => c.phone);
  for (let k = 0; k < phones.length; k += 100) {
    const { data } = await db.from('calldesk_outreach_leads').select('phone').eq('product', 'calldesk').in('phone', phones.slice(k, k + 100));
    for (const r of data ?? []) knownPhone.add(String(r.phone));
  }
  const fresh = [...cands.values()].filter((c) => !known.has(c.domain) && !knownPhone.has(c.phone));
  console.log(`${items.length} items, ${cands.size} relevant with phone, ${known.size} domains already leads, ${knownPhone.size} phones already leads, ${fresh.length} new`);
  writeFileSync(process.env.CSV || '/tmp/apify-new-leads.csv', ['company,domain,city,cc,phone,category'].concat(fresh.map((c) => [c.name, c.domain, c.city, c.cc, c.phone, c.cat].map((v) => `"${v.replace(/"/g, '""')}"`).join(','))).join('\n'));
  if (DRY_RUN) { console.log('dry run: nothing written'); return; }
  const now = new Date().toISOString();
  let inserted = 0;
  for (const c of fresh) {
    const { error } = await db.from('calldesk_outreach_leads').insert({
      product: 'calldesk', company_name: c.name, domain: c.domain, source_key: c.key, tier: null, location: `${c.city}, ${c.cc}`,
      description: `${c.cat || 'Business'} listed on Google Maps in ${c.city}.`, score: 35, region_blocked: false, status: 'new',
      signal_source: 'directory', signal_detail: `Google Maps listing (${c.cat || 'business'}), ${c.city}`, last_seen_at: now, phone: c.phone,
      signals: { reasons: ['+5: named as an AI / voice / automation business on Google Maps'], techPlatforms: [], mapsListing: { address: c.address, category: c.cat, country: c.cc, via: 'apify' } },
    });
    if (error) console.log(`insert ${c.domain}: ${error.message}`); else inserted++;
  }
  console.log(`inserted ${inserted}`);
}
if (process.argv[1]?.endsWith('import-apify-maps.ts')) main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
