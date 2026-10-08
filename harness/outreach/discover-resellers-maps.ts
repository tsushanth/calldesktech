#!/usr/bin/env -S node --import tsx
// Finds reseller/agency leads, WITH their phone numbers, by searching Google Maps (DataForSEO, about $0.002 a query) for
// AI voice / receptionist / automation businesses city by city. Phone and website come straight from the listing, so no
// separate enrichment is needed.
//
//   DRY_RUN=1 COUNTRIES=AU,NZ LIMIT_QUERIES=6 tsx harness/outreach/discover-resellers-maps.ts    # search and report, write nothing
//   COUNTRIES=AU,NZ,SG,GB,IN MAX_SPEND=0.40 tsx harness/outreach/discover-resellers-maps.ts      # insert new leads
//
// Every non-US/Canada lead is stored ON HOLD (region_blocked + signals.intlHold), like the register sources: nothing can be
// emailed, drafted or dialed until its country is released after a review of that country's marketing and calling rules
// (release-country.ts). US and Canadian leads are not held. Needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.
import { writeFileSync } from 'fs';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isPlatformDomain } from '@/lib/outreach/platformBlocklist';
import { isBlockedDomain, isRegionBlocked } from '@/lib/outreach/discovery/score';
import { INTL_HOLD_REASON } from '@/lib/outreach/discovery/registryCommon';
import { bareDomain, toE164 } from './enrich-phones-maps';

export const CITIES: Record<string, string[]> = {
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Canberra'],
  NZ: ['Auckland', 'Wellington', 'Christchurch'],
  SG: ['Singapore'],
  GB: ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Glasgow', 'Leeds', 'Bristol'],
  IN: ['Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Ahmedabad'],
  IE: ['Dublin', 'Cork'],
  PH: ['Manila', 'Cebu City', 'Davao'],
  PK: ['Karachi', 'Lahore', 'Islamabad'],
  LK: ['Colombo'],
  ZA: ['Johannesburg', 'Cape Town'],
  CA: ['Toronto', 'Vancouver', 'Calgary', 'Ottawa'],
  US: ['New York', 'Los Angeles', 'Chicago', 'Dallas', 'Houston', 'Austin', 'Miami', 'Atlanta', 'Seattle', 'Denver', 'Phoenix', 'Boston', 'San Francisco'],
};
const COUNTRY_NAME: Record<string, string> = {
  AU: 'Australia', NZ: 'New Zealand', SG: 'Singapore', GB: 'United Kingdom', IN: 'India', IE: 'Ireland', PH: 'Philippines',
  PK: 'Pakistan', LK: 'Sri Lanka', ZA: 'South Africa', CA: 'Canada', US: 'United States',
};
export const QUERIES = ['AI voice agent company', 'AI receptionist', 'AI automation agency', 'conversational AI company', 'AI call answering service', 'voice AI development'];

// A listing is kept only when its NAME says it is an AI / voice / automation business and its category is not an obvious miss
// (recruiters, talent and speaker agencies, studios, clinics, shops ...).
const NAME_SIGNAL = /\b(ai|a\.i\.|voice|voices|bot|bots|chatbot|automation|automate|automated|receptionist|answering|conversational|virtual|intelligen\w*|gpt|llm|agentic|agents?)\b/i;
const BAD_CATEGORY = /\b(recruit\w*|employment|staffing|talent|entertain\w*|speakers?|recording|studio|school|universit\w*|college|training|hospital|clinic|dent\w*|doctor|restaurant|cafe|store|shop|real estate|lawyer|law firm|attorney|bank|insurance|church|government|model(?:ing)? agency|translat\w*|interpret\w*|voice[- ]?over|photograph\w*|printing|travel|hotel|gym|beauty)\b/i;
const BAD_NAME = /\b(recruit\w*|staffing|talent|speakers?|voice[- ]?over|studio|clinic|dental|hotel|casting)\b/i;

export function relevantListing(title: string | undefined, category: string | undefined): boolean {
  const t = title ?? '';
  if (!NAME_SIGNAL.test(t)) return false;
  if (BAD_CATEGORY.test(category ?? '') || BAD_NAME.test(t)) return false;
  return true;
}

interface MapsItem { title?: string; phone?: string; domain?: string; url?: string; category?: string; address?: string; place_id?: string; cid?: string }

async function search(keyword: string, country: string): Promise<{ cost: number; items: MapsItem[] }> {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  const res = await fetch('https://api.dataforseo.com/v3/serp/google/maps/live/advanced', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keyword, location_name: country, language_code: 'en', depth: 60 }]),
  });
  const j = (await res.json()) as { tasks?: Array<{ cost?: number; status_code?: number; result?: Array<{ items?: MapsItem[] }> }> };
  const t = j.tasks?.[0];
  if (!res.ok || !t || (t.status_code !== 20000 && t.status_code !== 40102)) throw new Error(`DataForSEO ${res.status} ${t?.status_code}`);
  return { cost: t.cost ?? 0, items: t.result?.[0]?.items ?? [] };
}

async function main() {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set');
  const DRY_RUN = process.env.DRY_RUN === '1';
  const MAX_SPEND = Number(process.env.MAX_SPEND) || 0.3;
  const LIMIT_QUERIES = Number(process.env.LIMIT_QUERIES) || 10000;
  const countries = (process.env.COUNTRIES || 'AU,NZ,SG,GB,IN').split(',').map((s) => s.trim().toUpperCase()).filter((c) => CITIES[c]);
  const db = getSupabaseAdmin();

  const plan: Array<{ cc: string; city: string; q: string }> = [];
  for (const cc of countries) for (const city of CITIES[cc]) for (const q of QUERIES) plan.push({ cc, city, q });
  console.log(`${plan.length} queries planned (${countries.join(',')}) | cap $${MAX_SPEND} | ${DRY_RUN ? 'dry run' : 'inserting'}`);

  type Cand = { name: string; domain: string; phone: string | null; category: string; cc: string; city: string; sourceKey: string; address: string };
  const cands = new Map<string, Cand>(); // by domain
  let spent = 0, queries = 0, listings = 0;
  for (const p of plan.slice(0, LIMIT_QUERIES)) {
    if (spent + 0.002 > MAX_SPEND) { console.log('spend cap reached'); break; }
    let r;
    try { r = await search(`${p.q} ${p.city}`, COUNTRY_NAME[p.cc]); } catch (e) { console.log(`query failed (${p.q} ${p.city}): ${(e as Error).message}`); continue; }
    spent += r.cost; queries++; listings += r.items.length;
    for (const i of r.items) {
      const domain = bareDomain(i.domain || i.url);
      if (!domain || cands.has(domain) || !relevantListing(i.title, i.category)) continue;
      if (isPlatformDomain(domain) || isBlockedDomain(domain) || isRegionBlocked(i.address ?? null, i.title)) continue;
      cands.set(domain, {
        name: i.title as string, domain, phone: toE164(i.phone), category: i.category ?? '', cc: p.cc, city: p.city,
        sourceKey: `calldesk:maps:${i.place_id || i.cid || domain}`, address: i.address ?? '',
      });
    }
  }
  console.log(`${queries} queries, ${listings} listings, ${cands.size} relevant distinct businesses, spent $${spent.toFixed(4)}`);

  // Drop domains that are already leads (any status), so nothing is duplicated and nothing dead is revived.
  const domains = [...cands.keys()];
  const known = new Set<string>();
  for (let i = 0; i < domains.length; i += 100) {
    const { data } = await db.from('calldesk_outreach_leads').select('domain').eq('product', 'calldesk').in('domain', domains.slice(i, i + 100));
    for (const r of data ?? []) known.add(String(r.domain).toLowerCase());
  }
  const fresh = [...cands.values()].filter((c) => !known.has(c.domain));
  console.log(`${known.size} already leads, ${fresh.length} new`);

  const byCountry: Record<string, { n: number; withPhone: number }> = {};
  for (const c of fresh) { const b = (byCountry[c.cc] ??= { n: 0, withPhone: 0 }); b.n++; if (c.phone) b.withPhone++; }
  console.log('new by country:', JSON.stringify(byCountry));
  writeFileSync(process.env.CSV || '/tmp/reseller-maps-discovery.csv', ['company,domain,country,city,phone,category,address'].concat(
    fresh.map((c) => [c.name, c.domain, c.cc, c.city, c.phone, c.category, c.address].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))).join('\n'));

  if (DRY_RUN) { console.log('dry run: nothing written'); return; }
  const now = new Date().toISOString();
  let inserted = 0;
  for (const c of fresh) {
    const held = c.cc !== 'US' && c.cc !== 'CA';
    const reasons = ['+5: named as an AI / voice / automation business on Google Maps'];
    const row = {
      product: 'calldesk', company_name: c.name, domain: c.domain, source_key: c.sourceKey, tier: null,
      location: `${c.city}, ${c.cc}`, description: `${c.category || 'Business'} listed on Google Maps in ${c.city}, ${COUNTRY_NAME[c.cc]}.`,
      score: 35, region_blocked: held, status: 'new', signal_source: 'directory', signal_detail: `Google Maps listing (${c.category || 'business'}), ${c.city}`,
      last_seen_at: now, ...(c.phone ? { phone: c.phone } : {}),
      signals: { reasons, techPlatforms: [] as string[], mapsListing: { address: c.address, category: c.category, country: c.cc }, ...(held ? { intlHold: { country: c.cc, reason: INTL_HOLD_REASON } } : {}) },
    };
    const { error } = await db.from('calldesk_outreach_leads').insert(row);
    if (error) console.log(`insert ${c.domain}: ${error.message}`); else inserted++;
  }
  console.log(`inserted ${inserted} leads (${fresh.filter((c) => c.cc !== 'US' && c.cc !== 'CA').length} on hold)`);
}

if (process.argv[1]?.endsWith('discover-resellers-maps.ts')) main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
