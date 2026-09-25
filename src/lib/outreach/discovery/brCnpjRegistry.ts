import { cleanEmail, isFreeMail } from './freightFmcsa';
import {
  cityCountry, emptyResult, formatIntlPhone, reject, titleCase, type RegistryLead, type RegistryResult,
} from './registryCommon';
import { listZipEntries, pickZipEntry, streamZipRows, type ZipEntry } from './zipStream';

// BRAZILIAN LEAD INGESTION from the RECEITA FEDERAL CNPJ OPEN DATA — the full
// national company register, every legal entity in Brazil, published monthly
// under the Lei de Acesso à Informação with no login and no API key. Read from
// the casadosdados.com.br mirror, which serves the Receita's own files over
// plain HTTP with byte ranges (verified live 2026-09-24).
//
// EVERY lead from here is stored ON HOLD (region_blocked + signals.intlHold),
// because it is not a US lead — see registryCommon.INTL_HOLD_REASON. Nothing is
// drafted or sent until a human releases Brazil with release-country.ts, and the
// drafts are then written in Portuguese (language.ts maps BR -> pt).
//
// ---- the files -------------------------------------------------------------
// Estabelecimentos{0..9}.zip — one ESTABLISHMENT per row, which is what carries
//   the address, the CNAE activity code, the phones and the email. Files 1-9 are
//   ~320-350 MB compressed (~1.08 GB of Latin-1 CSV each, ~5.4M rows); file 0 is
//   the ~2.1 GB tail. ';'-separated, every field quoted, NO HEADER ROW.
// Empresas{0..9}.zip — one COMPANY per row: razao_social (the legal name),
//   capital_social and porte_empresa. Needed because nome_fantasia (the trade
//   name) is blank on a large share of rows.
//
// Both sets are keyed on cnpj_basico, the first 8 digits of the CNPJ, which
// identify the COMPANY; the establishment is cnpj_basico + cnpj_ordem + dv.
//
// ---- how the two files are joined without a database -----------------------
// The Empresas files turn out to be RANGE-PARTITIONED on cnpj_basico in the
// order 1,2,...,9,0 (Empresas1 starts at 00000000, Empresas2 at 04631961, ...,
// Empresas0 holds the tail from 41273589 — measured live 2026-09-24). The
// boundaries change with every monthly release, so they are DISCOVERED at run
// time by reading the first row of each file (ten ~60 KB range requests), and
// only the files that can contain a wanted cnpj_basico are then streamed.
//
// The Estabelecimentos files are NOT sorted, so a single one's candidates are
// spread over the whole CNPJ range and in practice most Empresas files are
// needed. That second pass is therefore the expensive half of a run, which is
// why it can be turned off (`skipNameJoin`): with it off, only rows that already
// carry a nome_fantasia are kept, which is cheaper but loses leads and loses the
// porte/capital size filter.
//
// Nothing is ever written to disk and no whole file is held in memory: both
// passes go through zipStream.streamZipRows, and between them only the matched
// cnpj_basico keys are retained.

export const CNPJ_MIRROR = 'https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos';
// The newest complete release folder. 2026-09-18 exists in the index but holds
// no data files; 2026-09-14 is the newest with all 40 archives (checked
// 2026-09-24). `resolveCnpjRelease` re-checks this at run time so a stale
// constant degrades into a clear error rather than a 404 mid-stream.
export const CNPJ_RELEASE = '2026-09-14';
export const CNPJ_REGISTRY = 'Receita Federal do Brasil CNPJ register';
export const CNPJ_SOURCE_URL = 'https://dados-abertos-rf-cnpj.casadosdados.com.br/';
// File order as the range partition runs: 1..9 then 0 (the tail).
export const CNPJ_FILE_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;

export function estabelecimentosUrl(index: number, release = CNPJ_RELEASE): string {
  return `${CNPJ_MIRROR}/${release}/Estabelecimentos${index}.zip`;
}
export function empresasUrl(index: number, release = CNPJ_RELEASE): string {
  return `${CNPJ_MIRROR}/${release}/Empresas${index}.zip`;
}

// ---- columns ---------------------------------------------------------------
// Estabelecimentos, 0-based, 30 columns (verified against the live file).
export const ESTAB_COLUMNS = 30;
const C = {
  cnpjBasico: 0, cnpjOrdem: 1, cnpjDv: 2, matrizFilial: 3, nomeFantasia: 4,
  situacao: 5, dataSituacao: 6, motivo: 7, cidadeExterior: 8, pais: 9,
  dataInicio: 10, cnaePrincipal: 11, cnaeSecundaria: 12, tipoLogradouro: 13,
  logradouro: 14, numero: 15, complemento: 16, bairro: 17, cep: 18, uf: 19,
  municipio: 20, ddd1: 21, telefone1: 22, ddd2: 23, telefone2: 24,
  dddFax: 25, fax: 26, email: 27,
} as const;

export interface BrEstabRow {
  cnpjBasico: string;
  cnpjOrdem: string;
  cnpjDv: string;
  isMatriz: boolean;
  nomeFantasia: string | null;
  situacao: string;
  cidadeExterior: string | null;
  pais: string | null;
  cnaePrincipal: string;
  bairro: string | null;
  cep: string | null;
  uf: string | null;
  municipio: string | null;
  phone: string | null;
  email: string | null;
}

const clean = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

// "47" + "33851125" -> "+55 47 33851125". The register splits the area code
// (DDD) from the subscriber number and stores neither with a country code.
export function brPhone(ddd: string | undefined, num: string | undefined): string | null {
  const d = (ddd ?? '').replace(/\D/g, '');
  const n = (num ?? '').replace(/\D/g, '');
  // A Brazilian landline is 8 digits and a mobile 9, behind a 2-digit DDD.
  if (d.length !== 2 || n.length < 8 || n.length > 9) return null;
  return formatIntlPhone(`+55 ${d} ${n}`);
}

export function toBrEstabRow(f: string[]): BrEstabRow {
  return {
    cnpjBasico: (f[C.cnpjBasico] ?? '').trim(),
    cnpjOrdem: (f[C.cnpjOrdem] ?? '').trim(),
    cnpjDv: (f[C.cnpjDv] ?? '').trim(),
    isMatriz: (f[C.matrizFilial] ?? '').trim() === '1',
    nomeFantasia: clean(f[C.nomeFantasia]),
    situacao: (f[C.situacao] ?? '').trim(),
    cidadeExterior: clean(f[C.cidadeExterior]),
    pais: clean(f[C.pais]),
    cnaePrincipal: (f[C.cnaePrincipal] ?? '').trim(),
    bairro: clean(f[C.bairro]),
    cep: clean(f[C.cep]),
    uf: clean(f[C.uf]),
    municipio: clean(f[C.municipio]),
    phone: brPhone(f[C.ddd1], f[C.telefone1]) ?? brPhone(f[C.ddd2], f[C.telefone2]),
    email: clean(f[C.email]),
  };
}

// ---- CNAE -> vertical ------------------------------------------------------
// Only activity codes that are a PHONE-DRIVEN small business matching one of our
// verticals. Descriptions are the Receita's own (from Cnaes.zip, checked
// 2026-09-24) and are quoted in the comments so a code can be audited without
// the lookup file.
//
// Deliberately NOT included:
//   8630503 "Atividade médica ambulatorial restrita a consultas" — general
//     medical consulting rooms. No vertical fits: it is not dentistry and not
//     physiotherapy, and the physio product's vocabulary would mis-score it.
//   9602501 hairdressers/salons and 4744001 hardware retail — no vertical.
export const BR_CNAE_VERTICAL: Record<string, { product: string; typeLabel: string }> = {
  // "Atividades de contabilidade"
  '6920601': { product: 'accounting', typeLabel: 'accounting practice' },
  // "Corretagem na compra e venda e avaliação de imóveis"
  '6821801': { product: 'realestate', typeLabel: 'real-estate brokerage' },
  // "Atividade odontológica" / "... sem recursos para realização de procedimentos cirúrgicos"
  '8630504': { product: 'dental', typeLabel: 'dental practice' },
  '8630505': { product: 'dental', typeLabel: 'dental practice' },
  // "Transporte rodoviário de carga, exceto produtos perigosos e mudanças, intermunicipal, interestadual e internacional"
  '4930202': { product: 'freight', typeLabel: 'road freight carrier' },
  // "Instalação e manutenção elétrica"
  '4321500': { product: 'homeservices', typeLabel: 'electrical installation and maintenance contractor' },
  // "Atividades veterinárias"
  '7500100': { product: 'vets', typeLabel: 'veterinary practice' },
  // "Educação infantil - creche"
  '8511200': { product: 'childcare', typeLabel: 'creche and early-years nursery' },
  // "Atividades de fisioterapia" / "Atividades de terapia ocupacional"
  '8650004': { product: 'physio', typeLabel: 'physiotherapy practice' },
  '8650005': { product: 'physio', typeLabel: 'occupational-therapy practice' },
  // "Serviço de transporte de passageiros - locação de automóveis com motorista"
  '4923002': { product: 'taxi', typeLabel: 'chauffeured passenger-car operator' },
};

export const BR_PRODUCT_IDS = [...new Set(Object.values(BR_CNAE_VERTICAL).map((v) => v.product))].sort();

export function cnaesForProduct(product: string): string[] {
  return Object.keys(BR_CNAE_VERTICAL).filter((c) => BR_CNAE_VERTICAL[c].product === product);
}

// ---- filters ---------------------------------------------------------------

// '02' is "ATIVA". Everything else (01 nula, 03 suspensa, 04 inapta, 08 baixada)
// is a company that should not be contacted at all.
export const SITUACAO_ATIVA = '02';

// The 26 states plus the Distrito Federal. A row with anything else is a foreign
// or malformed establishment.
const BR_UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

export function isBrazilianUf(uf: string | null | undefined): boolean {
  return BR_UFS.has((uf ?? '').trim().toUpperCase());
}

// Brazilian free-mail providers, on top of the global list in freightFmcsa: the
// big local ISPs are as common as gmail on a small-business registration.
const BR_FREE_MAIL = /^(bol|uol|terra|ig|globo|oi|r7|zipmail|superig|itelefonica|brturbo|yahoo|globomail|netsite|click21)\b/i;

export function isBrFreeMail(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  if (!e.includes('@')) return false;
  if (isFreeMail(e)) return true;
  const host = e.split('@')[1] ?? '';
  // "bol.com.br" / "uol.com.br" — match on the first label only, so a real
  // business domain that merely contains "ig" is unaffected.
  return BR_FREE_MAIL.test(host);
}

// THE CONTADOR PROBLEM. A large share of Brazilian companies register the
// EMAIL OF THEIR ACCOUNTANT ("contador") as the company's CNPJ contact address,
// because the accountant is the one who files the registration. Mailing that
// address about a dental practice reaches a bookkeeping office that has no
// interest in it and, worse, one accountant's address can sit on hundreds of
// unrelated companies — so it would also look like a mail-bombing campaign.
//
// So for EVERY vertical except accounting, an email whose domain reads as an
// accounting office is rejected outright. For the accounting vertical the same
// domain is exactly the business we want, so it is kept.
const ACCOUNTANT_DOMAIN = /contabil|contabilidade|contadore?s|escritoriocontab|assessoriacontab|contab\d|^contab|\bcontab\b|escritcontab|orgcontabil/i;

export function looksLikeAccountantDomain(email: string | null | undefined): boolean {
  const host = ((email ?? '').split('@')[1] ?? '').toLowerCase();
  return !!host && ACCOUNTANT_DOMAIN.test(host);
}

// Large firms and chains. Capital and porte come from the Empresas join when it
// runs; these name markers are the fallback (and catch the cases where a holding
// company is registered as "micro"). "S.A." is only a marker when it stands
// alone as a legal form, so it is matched with boundaries rather than as a
// substring, which would hit "CASA" and "SAUDE".
const BIG_BR_NAME = /\b(s\.?\s?a\.?|sociedade anonima|holding|holdings|participacoes|participações|empreendimentos imobiliarios s|franchising|franquias|industria e comercio de|multinacional)\b/i;
// The register's own big names in these verticals: national chains and networks.
const BIG_BR_BRAND = /\b(odontocompany|oral ?unic|orthodontic|sorridents|imbra|dental ?uni|uniodonto|amil|hapvida|bradesco|itau|santander|banco do brasil|caixa economica|sest ?senat|rede ?d'?or|petz|cobasi|pet ?camp|kinoplex|jbs\b|ambev|correios|localiza|movida|unidas|jsl\b|tegma|rumo\b|braspress|jamef|tnt ?mercurio|total ?express|loggi|rapiddo|99 ?tecnologia|uber do brasil|maple ?bear|kumon|wizard|kroton|cogna)\b/i;

// A razao_social that is just a person's name plus a CPF is an MEI /
// empresário individual — the register writes "IRENILDA OLIVEIRA SILVA
// 11338767810" or "32.066.824 MAIZA BARBOSA SANTANA". Those are real
// businesses and squarely in the target size, but the name is personal data and
// makes a poor salutation, so they are kept and scored down, not dropped.
const MEI_NAME = /\b\d{11}\b|^\d{2}\.\d{3}\.\d{3}\s/;

export function looksLikeMei(name: string | null | undefined): boolean {
  return MEI_NAME.test((name ?? '').trim());
}

// A very long legal name is, empirically, a conglomerate or a chain of
// subsidiaries rather than a local practice.
const MAX_LEGAL_NAME = 90;

// ---- company (Empresas) side ----------------------------------------------

export interface BrEmpresa {
  razaoSocial: string;
  // '01' micro, '03' pequeno, '05' demais (i.e. everything larger). Blank on a
  // few rows.
  porte: string | null;
  // Declared share capital, in reais. Written with a comma decimal separator.
  capital: number | null;
}

// "120000000000,00" -> 120000000000. Returns null for a blank or unparseable value.
export function parseCapital(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function toBrEmpresa(f: string[]): { cnpjBasico: string; empresa: BrEmpresa } | null {
  const cnpjBasico = (f[0] ?? '').trim();
  const razaoSocial = (f[1] ?? '').trim().replace(/\s+/g, ' ');
  if (!cnpjBasico || !razaoSocial) return null;
  return { cnpjBasico, empresa: { razaoSocial, porte: clean(f[5]), capital: parseCapital(f[4]) } };
}

// porte '05' is "demais" — everything above "pequeno". Combined with a capital
// ceiling this is a far better small-business filter than any name heuristic,
// and it is the main reason the Empresas join is worth its cost.
export const MAX_CAPITAL = 10_000_000;

export function isSmallBusiness(e: BrEmpresa | null): { ok: boolean; reason?: string } {
  if (!e) return { ok: true }; // unknown: fall back to the name heuristics
  if (e.porte === '05') return { ok: false, reason: 'porte_empresa 05 (larger than "pequeno")' };
  if (e.capital !== null && e.capital > MAX_CAPITAL) return { ok: false, reason: `declared capital R$${Math.round(e.capital).toLocaleString('en-US')} above the small-business ceiling` };
  return { ok: true };
}

// ---- evaluation ------------------------------------------------------------

export type BrEvaluation =
  | { keep: true; adjust: number; reasons: string[]; typeLabel: string; product: string; usableEmail: string | null }
  | { keep: false; reason: string };

// Pass 1: everything decidable from the Estabelecimentos row alone. `product`
// restricts the scan to one vertical's CNAEs.
export function evaluateBrEstabRow(r: BrEstabRow, product: string): BrEvaluation {
  const mapped = BR_CNAE_VERTICAL[r.cnaePrincipal];
  if (!mapped) return { keep: false, reason: 'CNAE is not one of the mapped verticals' };
  if (mapped.product !== product) return { keep: false, reason: `CNAE belongs to the ${mapped.product} vertical` };
  if (r.situacao !== SITUACAO_ATIVA) return { keep: false, reason: `situacao_cadastral ${r.situacao || '?'} is not 02 (ativa)` };
  // A filial is a branch of a company whose head office is another row. Keeping
  // only the matriz gives one lead per company and drops chain branches, which
  // is the same collapse frRgeRegistry does on the SIREN.
  if (!r.isMatriz) return { keep: false, reason: 'filial (branch establishment), not the matriz' };
  if (r.cidadeExterior || (r.pais && r.pais !== '105')) return { keep: false, reason: 'establishment is outside Brazil' };
  if (!isBrazilianUf(r.uf)) return { keep: false, reason: 'UF is not a Brazilian state code' };

  const email = cleanEmail(r.email);
  if (!email) return { keep: false, reason: 'no email published' };
  // Checked before the free-mail rule: an accountant's address is wrong for the
  // vertical whether or not it is free-mail.
  if (product !== 'accounting' && looksLikeAccountantDomain(email)) {
    return { keep: false, reason: "email domain is an accounting office (the company's contador, not the business)" };
  }

  const reasons: string[] = [];
  let adjust = 0;
  const add = (d: number, why: string) => { adjust += d; reasons.push(`${d >= 0 ? '+' : ''}${d}: ${why}`); };

  add(3, `registered with the Receita Federal under CNAE ${r.cnaePrincipal} (${mapped.typeLabel}) and currently ativa`);

  // The free-mail rule, as in the merged sources: a free-mail address is a
  // scoring signal, not a usable contact, because it carries no verifiable
  // domain. CHILDCARE is the documented exception (see childcareUs.ts): a creche
  // genuinely runs on a gmail address, and dropping those would throw away the
  // smallest, most owner-run leads, which is exactly the population the vertical
  // is for.
  const free = isBrFreeMail(email);
  const usableEmail = !free || product === 'childcare' ? email : null;
  if (!free) add(5, 'business-domain email address published in the CNPJ register');
  else if (product === 'childcare') add(-8, 'register email is a free-mail address (kept: normal for a small creche, but it carries no verifiable domain)');
  else add(-10, 'register email is a free-mail address, so it is not used as the contact');

  if (r.phone) add(2, 'publishes a phone number in the register');
  if (r.nomeFantasia) add(1, 'publishes a trade name (nome fantasia)');

  return { keep: true, adjust, reasons, typeLabel: mapped.typeLabel, product: mapped.product, usableEmail };
}

// Pass 2: the checks that need the company row. Returns null when the candidate
// survives, or the rejection reason.
export function rejectOnCompany(name: string, empresa: BrEmpresa | null): string | null {
  const size = isSmallBusiness(empresa);
  if (!size.ok) return size.reason ?? 'not a small business';
  const legal = empresa?.razaoSocial ?? name;
  if (legal.length > MAX_LEGAL_NAME) return `legal name is ${legal.length} characters (conglomerate or chain of subsidiaries)`;
  if (BIG_BR_NAME.test(legal)) return 'legal name carries an S.A./holding/participações form';
  if (BIG_BR_BRAND.test(legal) || BIG_BR_BRAND.test(name)) return 'national chain or brand name';
  return null;
}

export function brSourceKey(product: string, cnpjBasico: string): string {
  return `${product}:br:${cnpjBasico}`;
}

export function fullCnpj(r: BrEstabRow): string {
  return `${r.cnpjBasico}${r.cnpjOrdem}${r.cnpjDv}`;
}

export function toBrLead(r: BrEstabRow, ev: Extract<BrEvaluation, { keep: true }>, empresa: BrEmpresa | null, municipality: string | null): RegistryLead {
  // The trade name is the display name when there is one; otherwise the legal
  // name from the Empresas join.
  const rawName = r.nomeFantasia ?? empresa?.razaoSocial ?? '';
  const name = titleCase(rawName);
  const legalRaw = empresa?.razaoSocial ?? null;
  const city = municipality ? titleCase(municipality) : null;
  const location = cityCountry(city ?? null, 'BR');
  const reasons = [...ev.reasons];
  let adjust = ev.adjust;
  if (looksLikeMei(legalRaw ?? rawName)) {
    adjust -= 6;
    reasons.push('-6: registered as an MEI / empresário individual under a personal name');
  }
  if (empresa?.porte === '01') { adjust += 2; reasons.push('+2: classified as a microempresa by the Receita Federal'); }
  else if (empresa?.porte === '03') { adjust += 3; reasons.push('+3: classified as an empresa de pequeno porte by the Receita Federal'); }

  let description = `Listed in the Receita Federal do Brasil CNPJ register as an active ${ev.typeLabel}`;
  if (location) description += `, based in ${location}`;
  return {
    sourceKey: brSourceKey(ev.product, r.cnpjBasico),
    name,
    legalName: legalRaw && legalRaw !== name ? legalRaw : null,
    city,
    state: r.uf ? r.uf.toUpperCase() : 'BR',
    phone: r.phone,
    licenseId: fullCnpj(r),
    registryName: CNPJ_REGISTRY,
    typeLabel: ev.typeLabel,
    contactName: null,
    location,
    description: `${description}.`,
    signalDetail: `CNPJ ${fullCnpj(r)}, CNAE ${r.cnaePrincipal}, situação ativa, ${r.uf ?? '?'}${empresa?.porte ? `, porte ${empresa.porte}` : ''}${r.phone ? `; register phone ${r.phone}` : ''}`,
    adjust,
    reasons,
    email: ev.usableEmail,
    contactSourceUrl: ev.usableEmail ? CNPJ_SOURCE_URL : null,
    country: 'BR',
  };
}

// ---- municipality names ----------------------------------------------------
//
// The Estabelecimentos row carries the Receita's own 4-digit municipality CODE,
// not a name, and the lead's `location` is what language.detectDraftLanguage and
// websiteDiscovery both read. Municipios.zip is 43 KB and holds the whole table,
// so it is fetched once per run and kept in memory.
export const MUNICIPIOS_MEMBER = /MUNIC/i;

export async function loadBrMunicipalities(opts: { release?: string; log?: (m: string) => void } = {}): Promise<Map<string, string>> {
  const url = `${CNPJ_MIRROR}/${opts.release ?? CNPJ_RELEASE}/Municipios.zip`;
  const { entries } = await listZipEntries(url);
  const entry = pickZipEntry(entries, MUNICIPIOS_MEMBER, url);
  const map = new Map<string, string>();
  await streamZipRows({
    url,
    entry,
    delimiter: ';',
    onRow: (row) => {
      const code = (row[0] ?? '').trim();
      const name = (row[1] ?? '').trim();
      if (code && name) map.set(code, name);
    },
  });
  if (map.size < 5000) throw new Error(`${url}: only ${map.size} municipalities; the table layout may have changed`);
  opts.log?.(`br cnpj: ${map.size} municipality names loaded`);
  return map;
}

// ---- the Empresas range partition -----------------------------------------

export interface EmpresasPartition {
  index: number;
  url: string;
  // cnpj_basico of the file's FIRST row, i.e. the inclusive lower bound.
  from: string;
  entry: ZipEntry;
}

// Reads the first row of each Empresas file to learn this release's boundaries.
// Ten small range requests; the partition order is 1..9 then 0.
export async function readEmpresasPartitions(opts: { release?: string; log?: (m: string) => void } = {}): Promise<EmpresasPartition[]> {
  const release = opts.release ?? CNPJ_RELEASE;
  const parts: EmpresasPartition[] = [];
  for (const index of CNPJ_FILE_ORDER) {
    const url = empresasUrl(index, release);
    const { entries } = await listZipEntries(url);
    const entry = pickZipEntry(entries, /EMPRE/i, url);
    let from = '';
    await streamZipRows({
      url, entry, delimiter: ';', maxCompressedBytes: 60_000,
      onRow: (row) => { from = (row[0] ?? '').trim(); return false; },
    });
    if (!from) throw new Error(`${url}: could not read the first cnpj_basico`);
    parts.push({ index, url, from, entry });
  }
  // Ascending by lower bound, so the partition a key falls in is the last one
  // whose `from` is <= the key. Sorted rather than assumed, so a release that
  // reorders the files still works.
  parts.sort((a, b) => a.from.localeCompare(b.from));
  opts.log?.(`br cnpj: Empresas partitions ${parts.map((p) => `${p.index}@${p.from}`).join(' ')}`);
  return parts;
}

// Which partitions can contain any of the wanted keys. Keys are 8-digit
// zero-padded strings, so a plain string comparison is the right ordering.
export function partitionsFor(parts: EmpresasPartition[], keys: Iterable<string>): EmpresasPartition[] {
  const needed = new Set<number>();
  for (const key of keys) {
    let hit = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].from.localeCompare(key) <= 0) hit = i; else break;
    }
    needed.add(hit);
  }
  return parts.filter((_p, i) => needed.has(i));
}

// Second streaming pass: razao_social / porte / capital for exactly the keys
// collected in pass 1. Only the needed partitions are streamed, and only the
// wanted keys are retained, so memory stays proportional to the candidate count
// rather than to the 60-million-row register.
export async function fetchBrEmpresas(
  keys: Set<string>,
  opts: { release?: string; log?: (m: string) => void; partitions?: EmpresasPartition[] } = {},
): Promise<Map<string, BrEmpresa>> {
  const out = new Map<string, BrEmpresa>();
  if (!keys.size) return out;
  const parts = opts.partitions ?? await readEmpresasPartitions(opts);
  const wanted = partitionsFor(parts, keys);
  opts.log?.(`br cnpj: joining ${keys.size} company names from Empresas ${wanted.map((p) => p.index).join(',')}`);
  for (const part of wanted) {
    let found = 0;
    await streamZipRows({
      url: part.url,
      entry: part.entry,
      delimiter: ';',
      onRow: (row) => {
        const key = (row[0] ?? '').trim();
        if (!keys.has(key) || out.has(key)) return;
        const parsed = toBrEmpresa(row);
        if (!parsed) return;
        out.set(key, parsed.empresa);
        found++;
        // Every key resolved: no point reading the rest of the register.
        if (out.size === keys.size) return false;
      },
      log: opts.log,
    });
    opts.log?.(`br cnpj: Empresas${part.index} supplied ${found} names (${out.size}/${keys.size} resolved)`);
    if (out.size === keys.size) break;
  }
  return out;
}

// ---- the source ------------------------------------------------------------

export interface BrCnpjOpts {
  isKnown?: (sourceKey: string) => boolean;
  log?: (m: string) => void;
  release?: string;
  // Which Estabelecimentos file to scan. A run is ONE file, so the mini's disk
  // and its 40-minute deadline are respected: file 1-9 is ~342 MB compressed
  // (~1.08 GB inflated, ~5.4M rows) and takes roughly 3 minutes to stream; the
  // Empresas join adds up to ~9 more.
  fileIndex?: number;
  // Resume point inside the file, as a row index. Combined with `maxRows` this
  // makes a long file restartable across runs without any state on disk.
  startRow?: number;
  maxRows?: number;
  // Stop after this many compressed bytes. Used by the dry run to read a 5%
  // prefix; also the safety valve if a run is running out of time.
  maxCompressedBytes?: number;
  // Skip the second pass. Cheaper, but only rows that already carry a
  // nome_fantasia survive, and the porte/capital size filter is unavailable.
  skipNameJoin?: boolean;
  municipalities?: Map<string, string>;
  // Test seam: supply rows instead of streaming the archive.
  rowsOverride?: string[][];
}

export interface BrCnpjResult extends RegistryResult {
  // Where the scan stopped, so the next run can resume from here.
  nextRow: number;
  fileIndex: number;
  // True when the file was read to the end and there is nothing left to resume.
  complete: boolean;
}

// Verifies the configured release folder still resolves, so a stale
// CNPJ_RELEASE fails with a clear message instead of a mid-stream 404.
export async function resolveCnpjRelease(candidates: string[] = [CNPJ_RELEASE]): Promise<string> {
  const errors: string[] = [];
  for (const release of candidates) {
    try {
      await listZipEntries(estabelecimentosUrl(1, release));
      return release;
    } catch (e) {
      errors.push(`${release}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`no usable CNPJ release folder (${errors.join('; ')})`);
}

// One pass over one Estabelecimentos file for one vertical.
export async function findBrCnpjCandidates(product: string, max: number, opts: BrCnpjOpts = {}): Promise<BrCnpjResult> {
  const log = opts.log ?? (() => {});
  const fileIndex = opts.fileIndex ?? 1;
  const startRow = opts.startRow ?? 0;
  const result: BrCnpjResult = { ...emptyResult(), nextRow: startRow, fileIndex, complete: false };
  if (!BR_PRODUCT_IDS.includes(product)) {
    result.errors.push(`br cnpj: no CNAE mapping for the ${product} vertical`);
    return result;
  }
  // Pass 1 keeps the surviving rows (a few thousand per file per vertical), so
  // the company join can be done in one go afterwards.
  const kept: { row: BrEstabRow; ev: Extract<BrEvaluation, { keep: true }> }[] = [];
  const seen = new Set<string>();
  let lastRow = startRow;

  try {
    const release = opts.release ?? CNPJ_RELEASE;
    const municipalities = opts.municipalities ?? (opts.rowsOverride ? new Map<string, string>() : await loadBrMunicipalities({ release, log }));

    const onRow = (row: string[], index: number): boolean | void => {
      lastRow = index + 1;
      result.scanned++;
      if (row.length < ESTAB_COLUMNS - 2) { reject(result, 'short row'); return; }
      const r = toBrEstabRow(row);
      const ev = evaluateBrEstabRow(r, product);
      if (!ev.keep) { reject(result, ev.reason); return; }
      // One lead per COMPANY: a company can only have one matriz, but a defensive
      // dedupe costs nothing and protects against a duplicated row.
      if (seen.has(r.cnpjBasico)) { reject(result, 'duplicate cnpj_basico'); return; }
      if (opts.isKnown?.(brSourceKey(product, r.cnpjBasico))) { reject(result, 'already known'); return; }
      seen.add(r.cnpjBasico);
      kept.push({ row: r, ev });
      if (kept.length >= max) return false;
      if (opts.maxRows && result.scanned >= opts.maxRows) return false;
      if (result.scanned % 500_000 === 0) log(`br cnpj ${product}: ${result.scanned} rows scanned, ${kept.length} kept`);
    };

    if (opts.rowsOverride) {
      for (let i = 0; i < opts.rowsOverride.length; i++) {
        if (onRow(opts.rowsOverride[i], i) === false) break;
      }
      result.complete = true;
    } else {
      const url = estabelecimentosUrl(fileIndex, release);
      const { entries } = await listZipEntries(url);
      const entry = pickZipEntry(entries, /ESTABELE/i, url);
      log(`br cnpj ${product}: streaming ${url} (${entry.compressedSize} compressed, ${entry.uncompressedSize} inflated) from row ${startRow}`);
      const stream = await streamZipRows({
        url, entry, delimiter: ';', startRow, maxCompressedBytes: opts.maxCompressedBytes, onRow, log,
      });
      // Read to the end only if nothing cut it short.
      result.complete = !stream.truncated && kept.length < max && !(opts.maxRows && result.scanned >= opts.maxRows);
    }
    result.nextRow = lastRow;

    // Pass 2: names and company size.
    let empresas = new Map<string, BrEmpresa>();
    if (!opts.skipNameJoin && kept.length && !opts.rowsOverride) {
      empresas = await fetchBrEmpresas(new Set(kept.map((k) => k.row.cnpjBasico)), { release, log });
    }

    for (const { row, ev } of kept) {
      const empresa = empresas.get(row.cnpjBasico) ?? null;
      // No trade name and no legal name: nothing to address the business by, so
      // the lead is unusable. This is what `skipNameJoin` trades away.
      if (!row.nomeFantasia && !empresa?.razaoSocial) { reject(result, 'no nome fantasia and no razao social'); continue; }
      const bad = rejectOnCompany(row.nomeFantasia ?? '', empresa);
      if (bad) { reject(result, bad); continue; }
      result.candidates.push(toBrLead(row, ev, empresa, municipalities.get(row.municipio ?? '') ?? null));
    }
    log(`br cnpj ${product}: scanned ${result.scanned}, candidates ${result.candidates.length}, next row ${result.nextRow}${result.complete ? ' (file complete)' : ''}`);
  } catch (e) {
    result.errors.push(`br cnpj ${product}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return result;
}

// Bulk-import entry point: one whole Estabelecimentos file for one vertical.
// FILE / START_ROW / MAX_ROWS come from the harness so a file can be walked over
// several runs.
export function allBrCnpjLeads(product: string, opts: BrCnpjOpts = {}): Promise<BrCnpjResult> {
  return findBrCnpjCandidates(product, Number.MAX_SAFE_INTEGER, opts);
}
