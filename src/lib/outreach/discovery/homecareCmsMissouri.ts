import { socrataGet } from './socrata';
import { DISCOVERY_UA } from './http';
import { titleCase, cityState, describeRegistryLead, formatUsPhone, type RegistryLead } from './registryCommon';
import { classifyHomecareName } from './homecareRegistry';

// Two further home-care sources beyond IL IDPH and NY DOH:
//
//  (a) CMS "Home Health Care Agencies" (Medicare Home Health Compare),
//      data.cms.gov datastore query 6jpm-sxkc, 12,460 agencies nationwide with a
//      phone number. These are MEDICARE-CERTIFIED agencies, which the lead
//      description says explicitly ("listed in the CMS Medicare Home Health
//      Compare dataset") — it is not a state licence and must not be worded as one.
//      type_of_ownership separates the small proprietary operators we want from
//      hospital-based and government agencies.
//  (b) Missouri licensed home health agencies (data.mo.gov 3dcz-79am). The
//      dataset has one row per SERVICE-AREA COUNTY, so the same agency appears
//      many times; rows are collapsed on licnumber.

export const CMS_QUERY_URL = 'https://data.cms.gov/provider-data/api/1/datastore/query/6jpm-sxkc/0';
export const CMS_DATASET_URL = 'https://data.cms.gov/provider-data/dataset/6jpm-sxkc';
const CMS_REGISTRY = 'CMS Medicare Home Health Compare';
const CMS_LIST_NOUN = 'dataset';
const CMS_TYPE_LABEL = 'Medicare-certified home health agency';

export const MO_HOST = 'data.mo.gov';
export const MO_HOMECARE_DATASET = '3dcz-79am';
const MO_REGISTRY = 'Missouri Department of Health and Senior Services';

export interface CmsRow {
  provider_name?: string;
  address?: string;
  citytown?: string;
  state?: string;
  zip_code?: string;
  telephone_number?: string;
  cms_certification_number_ccn?: string;
  type_of_ownership?: string;
}

export interface MoHomeRow {
  facname?: string;
  city?: string;
  state?: string;
  phone?: string;
  licnumber?: string;
  licyrexpires?: string;
}

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

export function evaluateCmsRow(r: CmsRow): Evaluation {
  const ccn = (r.cms_certification_number_ccn ?? '').trim();
  const name = (r.provider_name ?? '').trim();
  if (!ccn || !name) return { keep: false, reason: 'missing name or CCN' };
  const own = (r.type_of_ownership ?? '').toUpperCase();
  // Hospital-based, government and non-profit system agencies are not
  // owner-run small businesses.
  if (/GOVERNMENT|HOSPITAL|COMBINATION GOV|SKILLED NURSING FACILITY|REHABILITATION FACILITY/.test(own)) {
    return { keep: false, reason: 'hospital-based, facility-based or government agency' };
  }
  const cls = classifyHomecareName(name);
  if (!cls.keep) return cls;
  let adjust = cls.adjust;
  const reasons = [...cls.reasons];
  if (/PROPRIETARY/.test(own)) { adjust += 5; reasons.push('+5: proprietary (privately owned) agency'); }
  else if (/VOLUNTARY NON-?PROFIT/.test(own)) { adjust -= 5; reasons.push('-5: voluntary non-profit agency'); }
  if (!formatUsPhone(r.telephone_number)) { adjust -= 5; reasons.push('-5: no usable phone in the dataset record'); }
  return { keep: true, adjust, reasons };
}

export function toCmsLead(r: CmsRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase((r.provider_name as string).replace(/\s+/g, ' ').trim());
  const city = r.citytown?.trim() || null;
  const state = (r.state ?? '').trim().toUpperCase() || null;
  const location = cityState(city, state);
  const phone = formatUsPhone(r.telephone_number);
  const ccn = (r.cms_certification_number_ccn as string).trim();
  return {
    sourceKey: `homecare:cms:${ccn}`,
    name, legalName: null, city: city ? titleCase(city) : null, state, phone, licenseId: ccn,
    registryName: CMS_REGISTRY, typeLabel: CMS_TYPE_LABEL, contactName: null, location,
    description: describeRegistryLead({ typeLabel: CMS_TYPE_LABEL, registryName: CMS_REGISTRY, location, legalName: null, name, listNoun: CMS_LIST_NOUN }),
    signalDetail: `CMS Medicare home health agency CCN ${ccn}${r.type_of_ownership ? ` (${r.type_of_ownership.toLowerCase()})` : ''}${phone ? `; listed phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

export function evaluateMoHomeRow(r: MoHomeRow, now = new Date()): Evaluation {
  const lic = (r.licnumber ?? '').trim();
  if (!lic || !r.facname?.trim()) return { keep: false, reason: 'missing name or licence' };
  const exp = r.licyrexpires ? new Date(r.licyrexpires.endsWith('Z') ? r.licyrexpires : `${r.licyrexpires}Z`) : null;
  if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() < now.getTime()) return { keep: false, reason: 'licence expired' };
  const cls = classifyHomecareName(r.facname);
  if (!cls.keep) return cls;
  if (!formatUsPhone(r.phone)) return { keep: true, adjust: cls.adjust - 5, reasons: [...cls.reasons, '-5: no usable phone in the registry record'] };
  return cls;
}

export function toMoHomeLead(r: MoHomeRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase((r.facname as string).trim());
  const city = r.city?.trim() || null;
  const state = (r.state?.trim() || 'MO').toUpperCase();
  const location = cityState(city, state);
  const typeLabel = 'licensed home health agency';
  const phone = formatUsPhone(r.phone);
  const lic = (r.licnumber as string).trim();
  return {
    sourceKey: `homecare:mo:${lic.toUpperCase()}`,
    name, legalName: null, city: city ? titleCase(city) : null, state, phone, licenseId: lic,
    registryName: MO_REGISTRY, typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel, registryName: MO_REGISTRY, location, legalName: null, name }),
    signalDetail: `MO DHSS home health agency licence ${lic}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

// One row per service-area county in the Missouri dataset: collapse on licence.
export function collapseMoHomeRows(rows: MoHomeRow[]): MoHomeRow[] {
  const by = new Map<string, MoHomeRow>();
  for (const r of rows) {
    const key = (r.licnumber ?? '').trim().toUpperCase();
    if (key && !by.has(key)) by.set(key, r);
  }
  return [...by.values()];
}

// ---- network ---------------------------------------------------------------

const CMS_PAGE = 500;

export async function fetchCmsRows(offset: number, timeoutMs = 20_000): Promise<{ rows: CmsRow[]; total: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${CMS_QUERY_URL}?limit=${CMS_PAGE}&offset=${offset}`, {
      headers: { 'User-Agent': DISCOVERY_UA, Accept: 'application/json' }, signal: controller.signal,
    });
    if (!res.ok) throw new Error(`CMS HTTP ${res.status}`);
    const body = (await res.json()) as { results?: CmsRow[]; count?: number };
    return { rows: body.results ?? [], total: Number(body.count) || 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMoHomecareRows(log: (m: string) => void = () => {}): Promise<MoHomeRow[]> {
  return socrataGet<MoHomeRow>(MO_HOST, MO_HOMECARE_DATASET, {
    $order: 'licnumber', $limit: '5000',
    $select: 'facname,city,state,phone,licnumber,licyrexpires',
  }, log);
}
