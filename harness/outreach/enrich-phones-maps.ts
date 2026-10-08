#!/usr/bin/env -S node --import tsx
// Finds phone numbers for reseller/agency leads that have none, from Google Maps listings through DataForSEO
// (about $0.002 a lookup). A number is kept ONLY when the listing's own website domain equals the lead's domain, so a
// look-alike business never lends its phone number to the wrong lead.
//
//   DRY_RUN=1 LIMIT=20 MAX_SPEND=0.05 tsx harness/outreach/enrich-phones-maps.ts    # look up and report, write nothing
//   LIMIT=500 MAX_SPEND=1.00 tsx harness/outreach/enrich-phones-maps.ts             # write phone + signals.phoneSource
//
// Needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (the mini keeps them in ~/.dataforseo-env). Writing a phone does not make a
// lead callable: the batch builder still needs a US/Canada number with a call-region verdict (callRegion).
import { writeFileSync } from 'fs';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isPlatformDomain } from '@/lib/outreach/platformBlocklist';

const LIMIT = Number(process.env.LIMIT) || 100;
const MAX_SPEND = Number(process.env.MAX_SPEND) || 0.25;
const DRY_RUN = process.env.DRY_RUN === '1';
const CSV = process.env.CSV || '/tmp/reseller-phone-lookups.csv';

// Where to search: the lead's own location when it ends in a country code, else the domain's country, else the US.
const COUNTRY_BY_CODE: Record<string, string> = {
  AU: 'Australia', NZ: 'New Zealand', SG: 'Singapore', GB: 'United Kingdom', UK: 'United Kingdom', IN: 'India', IE: 'Ireland',
  CA: 'Canada', ZA: 'South Africa', PH: 'Philippines', PK: 'Pakistan', LK: 'Sri Lanka', US: 'United States',
};
const COUNTRY_BY_TLD: Array<[RegExp, string]> = [
  [/\.com\.au$|\.au$/, 'Australia'], [/\.co\.nz$|\.nz$/, 'New Zealand'], [/\.com\.sg$|\.sg$/, 'Singapore'], [/\.co\.uk$|\.uk$/, 'United Kingdom'],
  [/\.co\.in$|\.in$/, 'India'], [/\.ie$/, 'Ireland'], [/\.ca$/, 'Canada'], [/\.co\.za$|\.za$/, 'South Africa'], [/\.ph$|\.com\.ph$/, 'Philippines'],
  [/\.pk$|\.com\.pk$/, 'Pakistan'], [/\.lk$/, 'Sri Lanka'],
];

export function searchCountry(location: string | null, domain: string): string {
  const code = (location ?? '').match(/,\s*([A-Z]{2})\s*$/)?.[1];
  if (code && COUNTRY_BY_CODE[code] && code !== 'US') return COUNTRY_BY_CODE[code];
  const tld = COUNTRY_BY_TLD.find(([re]) => re.test(domain));
  return tld ? tld[1] : 'United States';
}

export const bareDomain = (d: string | null | undefined) => String(d ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

export function toE164(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return s.startsWith('+') ? `+${digits}` : null; // Maps phones come with their country code
}

async function lookup(keyword: string, country: string): Promise<{ cost: number; items: Array<{ title?: string; phone?: string; domain?: string }> }> {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  const res = await fetch('https://api.dataforseo.com/v3/serp/google/maps/live/advanced', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keyword, location_name: country, language_code: 'en', depth: 5 }]),
  });
  const j = (await res.json()) as { tasks?: Array<{ cost?: number; status_code?: number; result?: Array<{ items?: Array<{ title?: string; phone?: string; domain?: string }> }> }> };
  const t = j.tasks?.[0];
  if (!res.ok || t?.status_code !== 20000) throw new Error(`DataForSEO ${res.status} ${t?.status_code}`);
  return { cost: t.cost ?? 0, items: t.result?.[0]?.items ?? [] };
}

async function main() {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set');
  const db = getSupabaseAdmin();
  const leads: Array<{ id: string; company_name: string; domain: string; location: string | null; signals: Record<string, unknown> | null }> = [];
  for (let off = 0; leads.length < LIMIT; off += 500) {
    const { data, error } = await db.from('calldesk_outreach_leads')
      .select('id, company_name, domain, location, signals')
      .eq('product', 'calldesk').eq('region_blocked', false).neq('status', 'dead').is('phone', null).not('domain', 'is', null)
      .ilike('signals->>reasons', '%voice-AI%').order('id').range(off, off + 499);
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as typeof leads) {
      const sig = (l.signals ?? {}) as { phoneLookup?: unknown };
      if (sig.phoneLookup || isPlatformDomain(l.domain)) continue; // already tried, or a platform vendor
      leads.push(l);
      if (leads.length >= LIMIT) break;
    }
    if (!data || data.length < 500) break;
  }
  console.log(`${leads.length} leads to look up | max spend $${MAX_SPEND} | ${DRY_RUN ? 'dry run' : 'writing'}`);

  let spent = 0, found = 0, mismatch = 0, none = 0;
  const rows: string[] = ['company,domain,country,result,phone,listing_title,listing_domain'];
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  for (const l of leads) {
    if (spent + 0.002 > MAX_SPEND) { console.log('spend cap reached'); break; }
    const country = searchCountry(l.location, l.domain);
    const city = (l.location ?? '').split(',')[0].trim();
    let result = 'none', phone: string | null = null, top: { title?: string; domain?: string } = {};
    try {
      const r = await lookup(`${l.company_name} ${city}`.trim(), country);
      spent += r.cost;
      const hit = r.items.find((i) => bareDomain(i.domain) === bareDomain(l.domain) && toE164(i.phone));
      top = r.items[0] ?? {};
      if (hit) { phone = toE164(hit.phone); result = 'found'; found++; } else if (r.items.length) { result = 'listing did not match the lead'; mismatch++; } else none++;
    } catch (e) { result = `error: ${(e as Error).message}`; }
    rows.push([l.company_name, l.domain, country, result, phone, top.title, top.domain].map(q).join(','));
    if (!DRY_RUN) {
      const signals = { ...(l.signals ?? {}), phoneLookup: { at: new Date().toISOString(), result, ...(phone ? { source: 'google_maps (DataForSEO)' } : {}) } };
      await db.from('calldesk_outreach_leads').update({ signals, ...(phone ? { phone } : {}) }).eq('id', l.id).is('phone', null);
    }
  }
  writeFileSync(CSV, rows.join('\n'));
  console.log(JSON.stringify({ looked_up: rows.length - 1, found, listing_mismatch: mismatch, no_listing: none, spent: Number(spent.toFixed(4)), csv: CSV }));
}

if (process.argv[1]?.endsWith('enrich-phones-maps.ts')) main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
