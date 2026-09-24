import { socrataGet } from './socrata';
import { titleCase, cityState, describeRegistryLead, formatUsPhone, splitDba, type RegistryLead } from './registryCommon';
import { isBigTowName } from './towingWa';

// Second towing registry: Montgomery County, Maryland's licensed tow-company
// list (Socrata dngn-wp3e on data.montgomerycountymd.gov, ~419 records). Small
// but it is a company record with a trade name, address and phone, and it gives
// the vertical a second state besides Washington. No email: stageEnrich resolves
// the business's own site.

export const MOCO_HOST = 'data.montgomerycountymd.gov';
export const MOCO_DATASET = 'dngn-wp3e';
export const MOCO_REGISTRY = 'Montgomery County, Maryland';
const TYPE_LABEL = 'licensed tow company';

export interface MocoRow {
  corporation_name?: string;
  trade_name?: string;
  business_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  business_tel_no?: string;
  registration_no?: string;
  expire_date?: string;
}

// Franchised car dealerships and rental/fleet operators registering their own
// tow trucks. Matched on the marque plus a dealership-ish word, or on the
// unambiguous dealership words alone.
const DEALERSHIP = /\b(nissan|toyota|honda|ford|chevrolet|chevy|buick|gmc|jeep|chrysler|dodge|ram trucks?|hyundai|kia|subaru|mazda|volkswagen|vw\b|audi|bmw|mercedes|lexus|acura|infiniti|volvo|porsche|tesla|cadillac|lincoln|mitsubishi|land rover|jaguar)\b|\b(auto ?(sales|group|mall|plaza)|car ?max|enterprise rent|hertz|avis|budget rent|u-?haul|penske truck|ryder)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[] } | { keep: false; reason: string };

export function evaluateMocoRow(r: MocoRow, now = new Date()): Evaluation {
  const name = (r.trade_name || r.corporation_name || '').trim();
  if (!name) return { keep: false, reason: 'no business name' };
  if (!r.registration_no?.trim()) return { keep: false, reason: 'no registration number' };
  // Registrations are annual and the dataset keeps history; only current ones.
  const exp = r.expire_date ? new Date(r.expire_date.endsWith('Z') ? r.expire_date : `${r.expire_date}Z`) : null;
  if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() < now.getTime()) return { keep: false, reason: 'registration expired' };
  if (isBigTowName(r.corporation_name, r.trade_name)) return { keep: false, reason: 'insurer/auction/network name' };
  // Car dealerships register tow trucks here too (their service department runs
  // them). They are not the independent tow operators this vertical targets.
  if (DEALERSHIP.test(`${r.corporation_name ?? ''} ${r.trade_name ?? ''}`)) return { keep: false, reason: 'car dealership, not a tow operator' };
  const phone = formatUsPhone(r.business_tel_no);
  return { keep: true, adjust: phone ? 0 : -5, reasons: phone ? [] : ['-5: no usable phone in the registry record'] };
}

export function toMocoLead(r: MocoRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  // trade_name is often "QUICK TOW INC dba CONGRESSIONAL TOWING": prefer the DBA.
  const { legal, dba } = splitDba((r.trade_name || r.corporation_name || '').trim());
  const name = titleCase(dba ?? legal);
  const corp = (r.corporation_name ?? '').trim();
  const legalName = corp && corp.toLowerCase() !== name.toLowerCase() ? titleCase(corp) : null;
  const city = r.city?.trim() || null;
  const state = (r.state?.trim() || 'MD').toUpperCase();
  const location = cityState(city, state);
  const licenseId = (r.registration_no as string).trim();
  const phone = formatUsPhone(r.business_tel_no);
  return {
    sourceKey: `towing:md:${licenseId.toUpperCase()}`,
    name, legalName, city: city ? titleCase(city) : null, state, phone, licenseId,
    registryName: MOCO_REGISTRY, typeLabel: TYPE_LABEL, contactName: null, location,
    description: describeRegistryLead({ typeLabel: TYPE_LABEL, registryName: MOCO_REGISTRY, location, legalName, name }),
    signalDetail: `Montgomery County MD tow registration ${licenseId}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

export async function fetchMocoRows(log: (m: string) => void = () => {}): Promise<MocoRow[]> {
  return socrataGet<MocoRow>(MOCO_HOST, MOCO_DATASET, {
    $where: "upper(corporation_name) like '%TOW%' OR upper(trade_name) like '%TOW%'",
    $order: 'registration_no', $limit: '1000',
    $select: 'corporation_name,trade_name,business_address,city,state,zip,business_tel_no,registration_no,expire_date',
  }, log);
}
