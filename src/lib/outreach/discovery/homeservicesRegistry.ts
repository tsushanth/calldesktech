import { socrataGet } from './socrata';
import { titleCase, cityState, describeRegistryLead, emptyResult, formatUsPhone, reject, splitDba, type RegistryLead, type RegistryResult } from './registryCommon';

// Home-services discovery from the Washington State Department of Labor &
// Industries registered-contractor list (Socrata m8qx-ubtq on data.wa.gov,
// ~76k ACTIVE contractor registrations). No email and no website in the data:
// stageEnrich resolves the business's own site from name + city, exactly like
// the towing/septic/homecare registry sources.
//
// The registration is a COMPANY record (business name, UBI, address, phone,
// principal), which is what we need. The trade is in specialtycode1desc /
// specialtycode2desc and the licence type in contractorlicensetypecodedesc;
// "GENERAL" construction contractors are excluded because they are mostly
// builders and remodelers rather than the phone-driven HVAC / plumbing /
// electrical / roofing service businesses this vertical targets.

export const WA_LNI_HOST = 'data.wa.gov';
export const WA_LNI_DATASET = 'm8qx-ubtq';
const WA_LNI_REGISTRY = 'Washington State Department of Labor & Industries';

export interface WaContractorRow {
  businessname?: string;
  contractorlicensenumber?: string;
  contractorlicensetypecodedesc?: string;
  specialtycode1desc?: string;
  specialtycode2desc?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  phonenumber?: string;
  ubi?: string;
  primaryprincipalname?: string;
  contractorlicensestatus?: string;
}

// Trade -> the words we use for it in the lead description. Matched against the
// licence type and both specialty descriptions (a firm's HVAC work is often in
// specialty 2, e.g. "ELECTRICAL" + "HVAC/RFRG").
const TRADES: { re: RegExp; label: string }[] = [
  { re: /hvac|refrig|rfrg|heating|air condition/i, label: 'HVAC/refrigeration contractor' },
  { re: /plumb/i, label: 'plumbing contractor' },
  { re: /electric/i, label: 'electrical contractor' },
  { re: /roof/i, label: 'roofing contractor' },
];

// National/franchise home-service brands and the big trade rollups: skip.
const BIG_HOMESERVICES = /\b(roto[- ]?rooter|mr\.? rooter|mr\.? electric|one hour heating|benjamin franklin plumbing|aire serv|ars\/?rescue rooter|service experts|home depot|lowe'?s|sears|comfort systems|emcor|apollo mechanical|mckinstry|harbor electric group)\b/i;

export type Evaluation = { keep: true; adjust: number; reasons: string[]; typeLabel: string } | { keep: false; reason: string };

// Some businesses register with a leading "!" or "#" to sort first in the
// public lookup; it is not part of the name and breaks website discovery.
export function cleanContractorName(raw: string | undefined | null): string {
  return (raw ?? '').replace(/^[!#*\s]+/, '').replace(/\s+/g, ' ').trim();
}

export function evaluateWaContractor(r: WaContractorRow): Evaluation {
  if (r.contractorlicensestatus !== 'ACTIVE') return { keep: false, reason: 'registration not active' };
  const name = cleanContractorName(r.businessname);
  if (!name) return { keep: false, reason: 'no business name' };
  if (!r.contractorlicensenumber?.trim()) return { keep: false, reason: 'no registration number' };
  if (BIG_HOMESERVICES.test(name)) return { keep: false, reason: 'national brand or franchise name' };
  const trades = `${r.contractorlicensetypecodedesc ?? ''} ${r.specialtycode1desc ?? ''} ${r.specialtycode2desc ?? ''}`;
  const trade = TRADES.find((t) => t.re.test(trades));
  if (!trade) return { keep: false, reason: 'trade not HVAC/plumbing/electrical/roofing' };

  const reasons: string[] = [];
  let adjust = 0;
  if (!formatUsPhone(r.phonenumber)) { adjust -= 5; reasons.push('-5: no usable phone in the registry record'); }
  // A specialty contractor registration (rather than a general one) is the
  // service-call business we want.
  if (/SPECIALTY/i.test(r.contractorlicensetypecodedesc ?? '')) { adjust += 3; reasons.push('+3: registered as a specialty (trade) contractor'); }
  return { keep: true, adjust, reasons, typeLabel: `registered ${trade.label}` };
}

export function toWaContractorLead(r: WaContractorRow, ev: { adjust: number; reasons: string[]; typeLabel: string }): RegistryLead {
  const { legal, dba } = splitDba(cleanContractorName(r.businessname));
  const name = titleCase(dba ?? legal);
  const legalName = dba ? titleCase(legal) : null;
  const city = r.city?.trim() || null;
  const state = (r.state?.trim() || 'WA').toUpperCase();
  const location = cityState(city, state);
  const licenseId = (r.contractorlicensenumber as string).trim();
  const phone = formatUsPhone(r.phonenumber);
  return {
    sourceKey: `homeservices:wa:${licenseId.toUpperCase()}`,
    name, legalName, city: city ? titleCase(city) : null, state, phone, licenseId,
    registryName: WA_LNI_REGISTRY, typeLabel: ev.typeLabel, contactName: null, location,
    description: describeRegistryLead({ typeLabel: ev.typeLabel, registryName: WA_LNI_REGISTRY, location, legalName, name }),
    signalDetail: `WA L&I contractor registration ${licenseId}${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust, reasons: ev.reasons,
  };
}

const DAY_MS = 86_400_000;
// 76k ACTIVE registrations is far too many to pull per run, so the $where does
// the trade filtering server side and the page walks forward a day at a time.
const PAGE = 400;
const WHERE = "contractorlicensestatus='ACTIVE' AND ("
  + "upper(contractorlicensetypecodedesc) like '%ELECTRICAL%' OR upper(contractorlicensetypecodedesc) like '%PLUMBING%'"
  + " OR upper(specialtycode1desc) like '%HVAC%' OR upper(specialtycode2desc) like '%HVAC%'"
  + " OR upper(specialtycode1desc) like '%PLUMBING%' OR upper(specialtycode2desc) like '%PLUMBING%'"
  + " OR upper(specialtycode1desc) like '%ELECTRICAL%' OR upper(specialtycode2desc) like '%ELECTRICAL%'"
  + " OR upper(specialtycode1desc) like '%ROOF%' OR upper(specialtycode2desc) like '%ROOF%')";

export async function findWaContractorCandidates(
  max: number, opts: { now?: Date; offsetOverride?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void } = {},
): Promise<RegistryResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const result = emptyResult();
  try {
    const cnt = await socrataGet<{ count: string }>(WA_LNI_HOST, WA_LNI_DATASET, { $select: 'count(*)', $where: WHERE }, log);
    const total = Number(cnt[0]?.count);
    if (!Number.isFinite(total) || total <= 0) throw new Error('could not read the active trade-contractor count');
    const day = Math.floor(now.getTime() / DAY_MS);
    const offset = opts.offsetOverride ?? (day * PAGE) % Math.max(1, total - PAGE);
    const rows = await socrataGet<WaContractorRow>(WA_LNI_HOST, WA_LNI_DATASET, {
      $where: WHERE, $order: 'contractorlicensenumber', $limit: String(PAGE), $offset: String(offset),
      $select: 'businessname,contractorlicensenumber,contractorlicensetypecodedesc,specialtycode1desc,specialtycode2desc,address1,city,state,zip,phonenumber,ubi,primaryprincipalname,contractorlicensestatus',
    }, log);
    result.scanned = rows.length;
    for (const r of rows) {
      if (result.candidates.length >= max) break;
      if (opts.isKnown?.(`homeservices:wa:${(r.contractorlicensenumber ?? '').trim().toUpperCase()}`)) { reject(result, 'already known'); continue; }
      const ev = evaluateWaContractor(r);
      if (!ev.keep) { reject(result, ev.reason); continue; }
      result.candidates.push(toWaContractorLead(r, ev));
    }
  } catch (e) {
    result.errors.push(`homeservices wa: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
