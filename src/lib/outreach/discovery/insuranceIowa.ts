import { CsvRowParser } from './csvStream';
import { findHeader, mapRow } from './delimitedStream';
import { cleanEmail, isFreeMail } from './freightFmcsa';
import { DISCOVERY_UA } from './http';
import { findEocd, parseCentralDirectory } from './zipStream';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, splitDba, type RegistryLead, type RegistryResult } from './registryCommon';

// Insurance-agency discovery from the Iowa Insurance Division's "Insurance
// Producer Business Entities Licensed in Iowa" dataset on the Iowa Data Hub
// (https://data.iowa.gov/catalog/dataset/668, the file API is
// https://idh-be.iowa.gov/api/v1/datasets/668/rows.csv). Free, no login, no key,
// refreshed weekly by the Division.
//
// Verified 2026-09-30: 13,004 rows, 13,002 with an email (99.98%), 13,004 with a
// phone (100%), every row an active licence (earliest expiry 2026-09-30, latest
// 2030-08-31). Only 1,517 rows are Iowa addresses: the rest are NON-RESIDENT
// agencies licensed to sell in Iowa, spread across the whole country (FL 1,597,
// CA 856, IL 847, TX 837, NE 609, MO 539, MN 475, KS 289, OK 79, LA 53, MS 33).
// That is the point of this source: it is the only free file with a business email
// for independent agencies in NE/MO/KS/OK/LA/MS, none of which publish their own
// bulk licensee file. The address state is recorded on the lead, not filtered.
//
// File practicalities:
//  * The endpoint answers with a ZIP (stored, one CSV member) even though the URL
//    ends in .csv. The host ignores Range requests (HTTP 200), so zipStream's
//    ranged reader cannot be used; the archive is only ~2.5 MB, so it is fetched
//    whole and the member is read from the central directory.
//  * There is NO licence number or NPN column, so the sourceKey is derived from
//    the normalised entity name + 5-digit zip. A repeat of that pair inside the
//    file is collapsed to one lead.
//  * Florida rows are skipped: flDfsRegistry already ingests every valid FL agency
//    (with its own licence-number key), so keeping them here would double-insert.
//  * About 10% of the emails are free-mail (gmail etc.); kept, scored down, the
//    same as the FL DFS source.
//  * Captive agents are heavily represented (amfam.com alone is 427 rows,
//    statefarm.com 146, shelter 89, fbfs 57, allstate 77) and so are national
//    brokerage roll-ups (Acrisure, AssuredPartners, NFP, Alliant, AmeriLife...).
//    Both are dropped by name AND by email domain.

export const IA_INS_DATASET_ID = 668;
export const IA_INS_ZIP_URL = `https://idh-be.iowa.gov/api/v1/datasets/${IA_INS_DATASET_ID}/rows.csv`;
export const IA_INS_SOURCE_URL = `https://data.iowa.gov/catalog/dataset/${IA_INS_DATASET_ID}`;
export const IA_INS_REGISTRY = 'Iowa Insurance Division';
const LIST_NOUN = 'licensee file';
const TYPE_LABEL = 'licensed insurance producer business entity';

export const IA_INS_COL = {
  name: 'entity_name',
  email: 'email',
  city: 'city',
  state: 'state',
  zip: 'zip_code',
  phone: 'business_phone',
  expiry: 'expiry_date',
} as const;

export interface IaInsuranceRow {
  name: string;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  expiry: string | null;
}

export function toIaInsuranceRow(o: Record<string, string>): IaInsuranceRow {
  const v = (k: string) => (o[k] ?? '').trim() || null;
  return {
    name: (o[IA_INS_COL.name] ?? '').replace(/\s+/g, ' ').trim(),
    email: v(IA_INS_COL.email),
    city: v(IA_INS_COL.city),
    state: v(IA_INS_COL.state),
    zip: v(IA_INS_COL.zip),
    phone: v(IA_INS_COL.phone),
    expiry: v(IA_INS_COL.expiry),
  };
}

// "2027-08-31 00:00:00 UTC" -> Date
export function parseIaDate(raw: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Stable id: no licence column exists, so name + 5-digit zip.
export function iaInsuranceId(r: Pick<IaInsuranceRow, 'name' | 'zip'>): string {
  const slug = r.name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const zip = (r.zip ?? '').replace(/\D/g, '').slice(0, 5);
  return `${slug}-${zip || 'nozip'}`;
}

// Captive carriers, national brokerage roll-ups and the big marketing orgs, by name.
const BIG_INSURANCE = /\b(state farm|allstate|farmers (insurance|agent)|geico|progressive|liberty mutual|nationwide|american family|amfam|usaa|travelers|the hartford|aaa|marsh|mclennan|aon|gallagher|brown\s*&\s*brown|usi|hub international|acrisure|alliant|nfp|lockton|willis towers|risk strategies|goosehead|assurance im|policygenius|esurance|safeco|foremost|amerilife|assuredpartners|amwins|alera group|truenorth|integrity marketing|world insurance|baldwin group|onedigital|arrowhead|shelter insurance|farm bureau|northwestern mutual|country financial|cuna mutual|mass ?mutual|new york life|prudential|metlife|thrivent|edward jones|lincoln financial|mutual of omaha|principal financial|primerica|transamerica|unum|aflac|colonial life|globe life|selectquote|american national)\b/i;
// Not an agency at all: banks, funeral homes, warranty sellers, adjusters, dealers, travel.
const NOT_AN_AGENCY = /\b(bank|bancorp|credit union|funeral|cremation|warranty|warranties|mortgage|adjust(er|ers|ing)|claims|dealer|dealers|travel|tours|premium finance|title (co|company|agency)|securities|broker[- ]dealer)\b/i;
// Carrier- and roll-up-owned email domains: the surest sign of a captive or large-brokerage producer.
const CAPTIVE_DOMAIN = /^(.*\.)?(statefarm|allstate|farmersagent|farmersinsurance|geico|progressive|libertymutual|amfam|amfamagent|americanfamily|nationwide|usaa|thehartford|travelers|goosehead|aaa|shelterinsurance|countryfinancial|fbfs|nm|acrisure|assuredpartners|nfp|alliant|aleragroup|amerilife|amwins|truenorthcompanies|risk-strategies|hubinternational|aon|ajg|gallagher|marsh|lockton|integritymarketing|onedigital|baldwin|mykeystone|3hcs|3hcg|pattoncompliance|brownandbrown|bbins|arrowheadgrp|usi|worldinsurance|edwardjones|primerica|thrivent|mutualofomaha|farmbureau|selectquote|lpl|american-national|unitedrisk)\.(com|net|org|global)$/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

export function evaluateIaInsuranceRow(r: IaInsuranceRow, now = new Date()): Evaluation {
  if (!r.name) return { keep: false, reason: 'no business name' };
  const exp = parseIaDate(r.expiry);
  if (!exp || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired or no expiry date' };
  const state = (r.state ?? '').toUpperCase();
  if (state === 'FL') return { keep: false, reason: 'Florida agency (covered by the FL DFS source)' };
  if (BIG_INSURANCE.test(r.name)) return { keep: false, reason: 'captive/national carrier or large brokerage name' };
  if (NOT_AN_AGENCY.test(r.name)) return { keep: false, reason: 'bank, funeral, warranty, adjuster, dealer or other non-agency business' };
  const email = cleanEmail(r.email);
  const domain = email?.split('@')[1] ?? '';
  if (domain && CAPTIVE_DOMAIN.test(domain)) return { keep: false, reason: 'carrier or large-brokerage email domain (captive or roll-up agent)' };
  const phone = formatUsPhone(r.phone);
  if (!email && !phone) return { keep: false, reason: 'no contact detail at all' };

  let adjust = 0;
  const reasons: string[] = [];
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };
  if (!email) add(-10, 'no published email in the licensee file');
  else if (isFreeMail(email)) add(-5, 'contact is a free-mail address (no business domain to verify)');
  else add(5, 'business-domain email published in the licensee file');
  if (!phone) add(-5, 'no usable phone in the licensee file');
  if (state && state !== 'IA') add(-2, 'non-resident agency licensed in Iowa (the address is in another state)');
  return { keep: true, adjust, reasons };
}

export function toIaInsuranceLead(r: IaInsuranceRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  // "LEGAL LLC DBA Trade Name" -> display the trade name, keep the legal name.
  const { legal, dba } = splitDba(r.name);
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const state = (r.state ?? '').toUpperCase() || null;
  const location = cityState(r.city, state);
  const email = cleanEmail(r.email);
  const phone = formatUsPhone(r.phone);
  const id = iaInsuranceId(r);
  return {
    sourceKey: `insurance:ia:${id}`,
    name,
    legalName,
    city: r.city ? titleCase(r.city) : null,
    state,
    phone,
    licenseId: id,
    registryName: IA_INS_REGISTRY,
    typeLabel: TYPE_LABEL,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel: TYPE_LABEL, registryName: IA_INS_REGISTRY, location, legalName, name, listNoun: LIST_NOUN }),
    signalDetail: `Iowa Insurance Division producer business entity licence${r.expiry ? `, active to ${r.expiry.slice(0, 10)}` : ''}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    contactSourceUrl: email ? IA_INS_SOURCE_URL : null,
  };
}

// ---- zip ------------------------------------------------------------------

// Reads the first .csv member of an in-memory zip. Supports stored and deflate.
// node:zlib is imported lazily so importing this module never pulls a node
// builtin into a client/edge bundle (same rule as zipStream.ts).
export async function readFirstCsvFromZip(buf: Buffer): Promise<string> {
  const eocd = findEocd(buf.subarray(Math.max(0, buf.length - 66_000)));
  const entries = parseCentralDirectory(buf.subarray(eocd.offset, eocd.offset + eocd.size), eocd.count);
  const entry = entries.find((e) => /\.csv$/i.test(e.name));
  if (!entry) throw new Error('zip has no .csv member');
  const p = entry.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error('bad zip local header');
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.toString('utf8');
  if (entry.method === 8) {
    const { inflateRawSync } = await import('node:zlib');
    return inflateRawSync(raw).toString('utf8');
  }
  throw new Error(`unsupported zip method ${entry.method}`);
}

export function parseIaInsuranceCsv(text: string): IaInsuranceRow[] {
  const parser = new CsvRowParser(',');
  const raws = [...parser.feed(text.replace(/^﻿/, ''))];
  const last = parser.end();
  if (last) raws.push(last);
  let header: string[] | null = null;
  const rows: IaInsuranceRow[] = [];
  for (const raw of raws) {
    if (!header) { if (raw.length > 1) header = findHeader(raw, [IA_INS_COL.name, IA_INS_COL.email, IA_INS_COL.phone, IA_INS_COL.expiry]); continue; }
    const o = mapRow(header, raw);
    if (Object.values(o).every((v) => v === '')) continue;
    rows.push(toIaInsuranceRow(o));
  }
  if (!header) throw new Error('Iowa producer-entity CSV header not found (layout changed?)');
  return rows;
}

// ---- network ---------------------------------------------------------------

export interface IaInsuranceOptions {
  now?: Date;
  // Restrict to address states, e.g. ['NE','MO','KS','OK','LA','MS','IA']. Default: every state except FL.
  states?: string[];
  isKnown?: (sourceKey: string) => boolean;
  url?: string;
  log?: (m: string) => void;
}

export async function allIaInsuranceLeads(opts: IaInsuranceOptions = {}): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const wanted = opts.states ? new Set(opts.states.map((s) => s.toUpperCase())) : null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    let buf: Buffer;
    try {
      const res = await fetch(opts.url ?? IA_INS_ZIP_URL, { headers: { 'User-Agent': DISCOVERY_UA, Accept: '*/*' }, signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`${IA_INS_ZIP_URL} unavailable (HTTP ${res.status})`);
      buf = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
    const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
    const rows = parseIaInsuranceCsv(isZip ? await readFirstCsvFromZip(buf) : buf.toString('utf8'));
    if (rows.length < 500) throw new Error(`only ${rows.length} rows parsed; refusing a truncated or error body`);
    opts.log?.(`iowa producer entities: ${rows.length} rows`);
    const seen = new Set<string>();
    for (const r of rows) {
      result.scanned++;
      if (wanted && !wanted.has((r.state ?? '').toUpperCase())) { reject(result, 'address state not requested'); continue; }
      const ev = evaluateIaInsuranceRow(r, now);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      const lead = toIaInsuranceLead(r, ev);
      if (seen.has(lead.sourceKey)) { reject(result, 'duplicate name and zip in the file'); continue; }
      seen.add(lead.sourceKey);
      if (opts.isKnown?.(lead.sourceKey)) { reject(result, 'already known'); continue; }
      result.candidates.push(lead);
    }
  } catch (e) {
    result.errors.push(`insurance ia: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

const DAY_MS = 86_400_000;

// One fetch per run, then a day-rotating window of `max` leads (same shape as FL DFS / Arkansas).
export async function findIaInsuranceCandidates(
  max: number,
  opts: IaInsuranceOptions & { startOverride?: number } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const all = await allIaInsuranceLeads({ ...opts, now });
  const result = emptyResult();
  result.scanned = all.scanned;
  result.rejected = all.rejected;
  result.errors = all.errors;
  if (!all.candidates.length) return result;
  const day = Math.floor(now.getTime() / DAY_MS);
  const start = opts.startOverride ?? (day * max) % all.candidates.length;
  for (let i = 0; i < all.candidates.length && result.candidates.length < max; i++) {
    result.candidates.push(all.candidates[(start + i) % all.candidates.length]);
  }
  return result;
}
