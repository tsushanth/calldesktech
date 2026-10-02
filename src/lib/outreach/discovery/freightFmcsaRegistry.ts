import { socrataGet } from './socrata';
import { sleep } from './http';
import { callerPhoneExclusion } from './callerPhonePolicy';
import { AUTHORITY_DATASET, CENSUS_DATASET, censusPhone, cleanEmail, evaluateBroker, mcNumber, stripZeros, titleCase, type AuthorityRow, type CensusRow } from './freightFmcsa';
import { cityState, describeRegistryLead, emptyResult, reject, type RegistryLead, type RegistryResult } from './registryCommon';

// Bulk, phone-first load of US freight BROKERS from FMCSA open data. The per-run stage in
// freightFmcsa.ts only takes brokers that publish an email (a few dozen per run); this walks the whole
// active-broker list and also keeps brokers with a callable census phone but no email, for the
// callers' lists. Source keys match the per-run stage (`freight:mc:<MC>`), so nothing is loaded twice.

const HOST = 'data.transportation.gov';
const REGISTRY = 'FMCSA (US DOT) broker authority and census files';
const WHERE = "broker_stat='A' AND bus_ctry_code='US' AND docket_number like 'MC%'";
const PAGE = 300;
const CENSUS_CHUNK = 150;

// FMCSA rate-limits anonymous callers hard (429 after a few quick pages). socrataGet already backs off
// for ~30s; on top of that, cool down for a minute and try again before giving the page up.
async function getPatient<T>(dataset: string, params: Record<string, string>, log: (m: string) => void): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await socrataGet<T>(HOST, dataset, params, log);
    } catch (e) {
      if (attempt >= 4 || !/429|too many requests/i.test(e instanceof Error ? e.message : String(e))) throw e;
      log(`fmcsa rate limited, cooling down 60s (attempt ${attempt + 1}/4)`);
      await sleep(60_000);
    }
  }
}

const AUTH_SELECT = 'docket_number,dot_number,broker_stat,broker_app_pend,broker_rev_pend,property_chk,bond_file,legal_name,dba_name,bus_city,bus_state_code,bus_ctry_code,bus_telno';
const CENSUS_SELECT = 'dot_number,legal_name,dba_name,email_address,phone,status_code,add_date,power_units,total_drivers,business_org_desc,phy_city,phy_state';

export function toFmcsaRegistryLead(auth: AuthorityRow, census: CensusRow, ev: { adjust: number; reasons: string[] }): RegistryLead {
  const name = titleCase(auth.legal_name || census.legal_name || '');
  const mc = mcNumber(auth.docket_number) as string;
  const dot = stripZeros(auth.dot_number);
  const city = (auth.bus_city || census.phy_city || '').trim();
  const state = (auth.bus_state_code || census.phy_state || '').trim().toUpperCase() || null;
  const location = cityState(city ? titleCase(city) : null, state);
  const email = cleanEmail(census.email_address);
  const phone = censusPhone(census, auth.bus_telno);
  const typeLabel = 'FMCSA-registered freight broker';
  return {
    sourceKey: `freight:mc:${mc}`,
    name,
    legalName: null,
    city: city ? titleCase(city) : null,
    state,
    phone,
    callerPhoneExcluded: phone ? callerPhoneExclusion({ name }) : null,
    licenseId: `MC-${mc}`,
    registryName: REGISTRY,
    typeLabel,
    contactName: null,
    location,
    description: describeRegistryLead({ typeLabel, registryName: REGISTRY, location, legalName: null, name, listNoun: 'registry' }),
    signalDetail: `FMCSA active broker authority MC-${mc} (DOT ${dot})${phone ? `; registry phone ${phone}` : ''}`,
    adjust: ev.adjust,
    reasons: ev.reasons,
    email,
    contactSourceUrl: email ? `https://${HOST}/resource/${CENSUS_DATASET}.json?dot_number=${dot}` : null,
  };
}

// Walks every active broker page by page. `max` bounds how many new candidates are returned (the
// import takes them all in one go when called with MAX_SAFE_INTEGER). Skips leads already held.
export async function findFmcsaBrokerRegistryLeads(
  opts: { max?: number; isKnown?: (sourceKey: string) => boolean; log?: (m: string) => void; now?: Date; startOffset?: number } = {},
): Promise<RegistryResult> {
  const log = opts.log ?? (() => {});
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  const now = opts.now ?? new Date();
  const result = emptyResult();
  try {
    const cnt = await socrataGet<{ count: string }>(HOST, AUTHORITY_DATASET, { $select: 'count(*)', $where: WHERE }, log);
    const total = Number(cnt[0]?.count);
    if (!Number.isFinite(total) || total <= 0) throw new Error('could not read active broker count');
    for (let offset = opts.startOffset ?? 0; offset < total && result.candidates.length < max; offset += PAGE) {
      await sleep(400);
      const auth = await getPatient<AuthorityRow>(AUTHORITY_DATASET, { $where: WHERE, $order: 'docket_number', $limit: String(PAGE), $offset: String(offset), $select: AUTH_SELECT }, log);
      result.scanned += auth.length;
      const fresh = auth.filter((a) => { const mc = mcNumber(a.docket_number); if (!mc) { reject(result, 'no MC docket'); return false; } if (opts.isKnown?.(`freight:mc:${mc}`)) { reject(result, 'already known'); return false; } return true; });
      const census = new Map<string, CensusRow>();
      const ids = [...new Set(fresh.map((a) => stripZeros(a.dot_number)).filter(Boolean))];
      for (let i = 0; i < ids.length; i += CENSUS_CHUNK) {
        await sleep(1000);
        const chunk = ids.slice(i, i + CENSUS_CHUNK);
        const rows = await getPatient<CensusRow>(CENSUS_DATASET, {
          $where: `dot_number in(${chunk.map((d) => `'${d.replace(/\D/g, '')}'`).join(',')})`,
          $select: CENSUS_SELECT, $limit: '300',
        }, log);
        for (const r of rows) census.set(stripZeros(r.dot_number), r);
      }
      for (const a of fresh) {
        if (result.candidates.length >= max) break;
        const c = census.get(stripZeros(a.dot_number));
        const ev = evaluateBroker(a, c, now, { allowNoEmail: true });
        if (!ev.keep) { reject(result, ev.reason); continue; }
        result.candidates.push(toFmcsaRegistryLead(a, c as CensusRow, ev));
      }
      log(`fmcsa brokers: offset ${offset}/${total}, candidates ${result.candidates.length}`);
    }
  } catch (e) {
    result.errors.push(`fmcsa brokers: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}
