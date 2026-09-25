import { describe, it, expect, vi, afterEach } from 'vitest';
import zlib from 'node:zlib';
import { INTL_HOLD_REASON } from '@/lib/outreach/discovery/registryCommon';
import { detectDraftLanguage } from '@/lib/outreach/language';
import {
  DelimitedRowParser, parseDelimited, findEocd, parseCentralDirectory, pickZipEntry,
  listZipEntries, streamZipRows, type ZipEntry,
} from '@/lib/outreach/discovery/zipStream';
import {
  toBrEstabRow, evaluateBrEstabRow, toBrLead, brPhone, parseCapital, isSmallBusiness,
  rejectOnCompany, isBrazilianUf, isBrFreeMail, looksLikeAccountantDomain, looksLikeMei,
  brSourceKey, fullCnpj, toBrEmpresa, partitionsFor, findBrCnpjCandidates, cnaesForProduct,
  estabelecimentosUrl, empresasUrl, BR_CNAE_VERTICAL, BR_PRODUCT_IDS, CNPJ_RELEASE,
  type BrEmpresa, type EmpresasPartition,
} from '@/lib/outreach/discovery/brCnpjRegistry';
import {
  toDenueRow, evaluateDenueRow, toDenueLead, denueHeaderIndex, denueDomain, denueUrl,
  isBigHeadcount, isMxFreeMail, isGenericName, denueSourceKey, findDenueCandidates, denueUrls, DENUE_SPLIT_STATES,
  scianForProduct, MX_SCIAN_VERTICAL, MX_PRODUCT_IDS, MX_STATE_CODES,
} from '@/lib/outreach/discovery/mxDenueRegistry';
import { accounting, realestate, dental, childcare, physio, vets, taxi, freight, homeservices } from '@/lib/outreach/products';

const keep = <T>(ev: { keep: boolean } | T) => {
  expect((ev as { keep: boolean }).keep, JSON.stringify(ev)).toBe(true);
  return ev as T & { keep: true; adjust: number; reasons: string[] };
};
const rejected = (ev: { keep: boolean }) => {
  expect(ev.keep, JSON.stringify(ev)).toBe(false);
  return ev as { keep: false; reason: string };
};

afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
// zipStream: the delimited parser and the zip container reader.
// ---------------------------------------------------------------------------
describe('DelimitedRowParser', () => {
  it('parses the CNPJ files\' quoted, semicolon-separated, header-less shape', () => {
    // A real Estabelecimentos row, truncated to the first columns.
    const rows = parseDelimited('"07396865";"0001";"68";"1";"";"08"\n"64904295";"0018";"51";"2";"";"02"\n', ';');
    expect(rows).toEqual([
      ['07396865', '0001', '68', '1', '', '08'],
      ['64904295', '0018', '51', '2', '', '02'],
    ]);
  });

  it('keeps a delimiter, a newline and an escaped quote that are inside a quoted field', () => {
    // A complemento of "LOTE 2; QUADRA F" would otherwise split the row, and a
    // trade name containing a quote would shift every later column.
    const rows = parseDelimited('"a";"LOTE 2; QUADRA F";"BAR ""DO ZE""";"line\none"\n', ';');
    expect(rows).toEqual([['a', 'LOTE 2; QUADRA F', 'BAR "DO ZE"', 'line\none']]);
  });

  it('handles CRLF, unquoted fields and a final row with no newline', () => {
    const rows = parseDelimited('a;b\r\nc;d\r\ne;f', ';');
    expect(rows).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']]);
  });

  it('carries parser state across chunk boundaries, including inside a quoted field', () => {
    // This is the case that matters: the inflate stream hands over arbitrary
    // byte chunks, so a row, a field and even an escaped quote can be split.
    const text = '"one";"two; still two";"thr""ee"\n"four";"five";"six"\n';
    for (const size of [1, 2, 3, 7, 13, 40]) {
      const p = new DelimitedRowParser(';');
      const out: string[][] = [];
      for (let i = 0; i < text.length; i += size) out.push(...p.feed(text.slice(i, i + size)));
      const last = p.end();
      if (last) out.push(last);
      expect(out, `chunk size ${size}`).toEqual([
        ['one', 'two; still two', 'thr"ee'],
        ['four', 'five', 'six'],
      ]);
    }
  });

  it('parses DENUE\'s comma shape with the same logic, including empty fields', () => {
    const rows = parseDelimited('"12299604","ACUARIO",,"112519","0 a 5 personas"\n', ',');
    expect(rows).toEqual([['12299604', 'ACUARIO', '', '112519', '0 a 5 personas']]);
  });

  it('refuses a multi-character delimiter rather than silently matching nothing', () => {
    expect(() => new DelimitedRowParser(';;')).toThrow(/single character/);
  });
});

// A real (tiny) zip archive, built the way both hosts write theirs: deflated
// members, a central directory, and an EOCD. Used so the container reader is
// tested against the actual format rather than a mock of it.
function buildZip(members: { name: string; body: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const m of members) {
    const name = Buffer.from(m.name, 'latin1');
    const raw = Buffer.from(m.body, 'latin1');
    const comp = zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt32LE(zlib.crc32 ? zlib.crc32(raw) : 0, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// Serves a Buffer over stubbed fetch with real Range/HEAD semantics, so
// listZipEntries and streamZipRows exercise the code paths they use live.
function serveZip(archive: Buffer) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-length': String(archive.length) } });
    }
    const range = String((init?.headers as Record<string, string> | undefined)?.Range ?? '');
    const m = /bytes=(\d+)-(\d+)/.exec(range);
    if (!m) return new Response(archive, { status: 200 });
    const from = Number(m[1]);
    const to = Math.min(Number(m[2]), archive.length - 1);
    const slice = archive.subarray(from, to + 1);
    return new Response(slice, {
      status: 206,
      headers: { 'content-range': `bytes ${from}-${to}/${archive.length}`, 'content-length': String(slice.length) },
    });
  });
}

describe('zipStream container reader', () => {
  const ROWS = Array.from({ length: 40 }, (_, i) => `"${String(i).padStart(8, '0')}";"row ${i}";"São Paulo"`).join('\n') + '\n';
  const archive = buildZip([
    { name: 'diccionario_de_datos/dict.csv', body: 'a;b\n' },
    { name: 'conjunto_de_datos/denue_inegi_09_.csv', body: ROWS },
  ]);

  it('finds the EOCD and reads every central-directory entry', () => {
    const eocd = findEocd(archive);
    expect(eocd.count).toBe(2);
    const entries = parseCentralDirectory(archive.subarray(eocd.offset, eocd.offset + eocd.size), eocd.count);
    expect(entries.map((e) => e.name)).toEqual(['diccionario_de_datos/dict.csv', 'conjunto_de_datos/denue_inegi_09_.csv']);
    expect(entries[1].method).toBe(8);
    expect(entries[1].uncompressedSize).toBe(Buffer.byteLength(ROWS, 'latin1'));
  });

  it('reports a missing EOCD rather than returning nothing', () => {
    expect(() => findEocd(Buffer.alloc(100))).toThrow(/end-of-central-directory/);
  });

  it('picks the data member and not the data dictionary, largest match winning', () => {
    const eocd = findEocd(archive);
    const entries = parseCentralDirectory(archive.subarray(eocd.offset, eocd.offset + eocd.size), eocd.count);
    expect(pickZipEntry(entries, /\.csv$/i).name).toBe('conjunto_de_datos/denue_inegi_09_.csv');
    expect(pickZipEntry(entries, /conjunto_de_datos/i).name).toBe('conjunto_de_datos/denue_inegi_09_.csv');
    expect(() => pickZipEntry(entries, /ESTABELE/)).toThrow(/no member matching/);
  });

  it('lists entries over the network with two range requests and inflates a member as Latin-1 rows', async () => {
    const fetchMock = serveZip(archive);
    vi.stubGlobal('fetch', fetchMock);
    const { total, entries } = await listZipEntries('https://example.test/a.zip');
    expect(total).toBe(archive.length);
    const entry = pickZipEntry(entries, /conjunto_de_datos/i);

    const seen: string[][] = [];
    const res = await streamZipRows({
      url: 'https://example.test/a.zip', entry, delimiter: ';', onRow: (row) => { seen.push(row); },
    });
    expect(res.scanned).toBe(40);
    expect(res.truncated).toBe(false);
    expect(seen[0]).toEqual(['00000000', 'row 0', 'São Paulo']);
    expect(seen[39]).toEqual(['00000039', 'row 39', 'São Paulo']);
  });

  it('stops on demand and resumes from a row index, so a huge file can be walked over several runs', async () => {
    vi.stubGlobal('fetch', serveZip(archive));
    const entry = pickZipEntry((await listZipEntries('https://example.test/a.zip')).entries, /conjunto/i);

    // onRow returning false cancels the body.
    const first: string[][] = [];
    const a = await streamZipRows({
      url: 'https://example.test/a.zip', entry, delimiter: ';',
      onRow: (row) => { first.push(row); if (first.length >= 5) return false; },
    });
    expect(first).toHaveLength(5);
    expect(a.scanned).toBe(5);

    // startRow skips the rows already handled without re-delivering them.
    const second: string[][] = [];
    const b = await streamZipRows({
      url: 'https://example.test/a.zip', entry, delimiter: ';', startRow: 5,
      onRow: (row) => { second.push(row); },
    });
    expect(b.scanned).toBe(40);
    expect(b.delivered).toBe(35);
    expect(second[0]).toEqual(['00000005', 'row 5', 'São Paulo']);
  });

  it('reads only a prefix when maxCompressedBytes is set, and does not treat the truncation as an error', async () => {
    vi.stubGlobal('fetch', serveZip(archive));
    const entry = pickZipEntry((await listZipEntries('https://example.test/a.zip')).entries, /conjunto/i);
    const res = await streamZipRows({
      url: 'https://example.test/a.zip', entry, delimiter: ';', maxCompressedBytes: 40, onRow: () => {},
    });
    // A truncated deflate stream throws; the reader must surface the rows it got.
    expect(res.truncated).toBe(true);
    expect(res.scanned).toBeLessThan(40);
    expect(res.errors ?? []).toEqual([]);
  });

  // The CDN in front of the CNPJ mirror answers a whole-object range with 200 and
  // the WHOLE FILE from byte 0 — which is exactly what a full-file pass asks for,
  // so this path is load-bearing in production, not an edge case.
  it('copes with a 200 whole-file answer by skipping the archive prefix to reach the member', async () => {
    const ranged = serveZip(archive);
    vi.stubGlobal('fetch', ranged);
    const entry = pickZipEntry((await listZipEntries('https://example.test/a.zip')).entries, /conjunto/i);

    // Cloudflare honours a small range but answers a range spanning essentially
    // the whole object with 200 and the entire file from byte 0.
    const ranged2 = serveZip(archive);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const m = /bytes=(\d+)-(\d+)/.exec(String((init?.headers as Record<string, string> | undefined)?.Range ?? ''));
      if (m && Number(m[2]) - Number(m[1]) > archive.length / 2) {
        return new Response(archive, { status: 200, headers: { 'content-length': String(archive.length) } });
      }
      return ranged2(url, init);
    }));
    const seen: string[][] = [];
    const res = await streamZipRows({
      url: 'https://example.test/a.zip', entry, delimiter: ';', onRow: (row) => { seen.push(row); },
    });
    // The member's 40 rows, decoded correctly — not the local header as garbage.
    expect(res.scanned).toBe(40);
    expect(seen[0]).toEqual(['00000000', 'row 0', 'São Paulo']);
    expect(seen[39]).toEqual(['00000039', 'row 39', 'São Paulo']);
  });

  // The mirror's CDN ignores Range on a CACHE MISS and honours it once the object
  // is warm, so a small range is retried before it is given up on.
  it('retries a small range that came back 200, then gives up rather than downloading gigabytes', async () => {
    let calls = 0;
    const flaky = serveZip(archive);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return flaky(url, init);
      calls++;
      // Cold on the first attempt, warm afterwards.
      if (calls === 1) return new Response(archive, { status: 200, headers: { 'content-length': String(archive.length) } });
      return flaky(url, init);
    }));
    const { entries } = await listZipEntries('https://example.test/a.zip');
    expect(entries).toHaveLength(2);
    expect(calls).toBeGreaterThan(1);

    // A server that never honours ranges is refused, not downloaded.
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(archive.length) } });
      return new Response(archive, { status: 200, headers: { 'content-length': String(archive.length) } });
    }));
    await expect(listZipEntries('https://example.test/a.zip')).rejects.toThrow(/byte ranges not honoured/);
  }, 60_000);

  // INEGI serves a URL that no longer exists as HTTP 200 with a 2 KB HTML page
  // (denue_15_csv.zip does exactly this), which must not surface as a baffling
  // zip-format error.
  it('names an HTML error page served as 200 instead of failing on the zip format', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html>Esta liga ya no existe', {
      status: 200, headers: { 'content-length': '2263', 'content-type': 'text/html' },
    })));
    await expect(listZipEntries('https://example.test/gone.zip')).rejects.toThrow(/returned an HTML page, not a zip/);
  });

  it('rejects an unsupported compression method by name', async () => {
    const entry: ZipEntry = { name: 'x.csv', method: 14, compressedSize: 10, uncompressedSize: 20, offset: 0 };
    await expect(streamZipRows({ url: 'u', entry, delimiter: ';', onRow: () => {} })).rejects.toThrow(/compression method 14/);
  });
});

// ---------------------------------------------------------------------------
// BRAZIL — Receita Federal CNPJ.
// ---------------------------------------------------------------------------
// A real Estabelecimentos row shape, 30 columns, as a field array.
function estab(over: Partial<Record<number, string>> = {}): string[] {
  const f = [
    '12345678', '0001', '90', '1', 'CLINICA ODONTO SORRISO', '02', '20200101', '00', '', '',
    '20100315', '8630504', '', 'RUA', 'DAS FLORES', '250', 'SALA 3', 'CENTRO', '01310100', 'SP',
    '7107', '11', '32145678', '', '', '', '', 'contato@clinicasorriso.com.br', '', '',
  ];
  for (const [k, v] of Object.entries(over)) f[Number(k)] = v;
  return f;
}
const MUNICIPALITIES = new Map([['7107', 'SAO PAULO'], ['6001', 'RIO DE JANEIRO']]);

describe('BR CNPJ row parsing', () => {
  it('maps all 30 columns, the CNPJ parts and the matriz flag', () => {
    const r = toBrEstabRow(estab());
    expect(r).toMatchObject({
      cnpjBasico: '12345678', cnpjOrdem: '0001', cnpjDv: '90', isMatriz: true,
      nomeFantasia: 'CLINICA ODONTO SORRISO', situacao: '02', cnaePrincipal: '8630504',
      uf: 'SP', municipio: '7107', email: 'contato@clinicasorriso.com.br',
    });
    expect(fullCnpj(r)).toBe('12345678000190');
    expect(toBrEstabRow(estab({ 3: '2' })).isMatriz).toBe(false);
    expect(toBrEstabRow(estab({ 4: '' })).nomeFantasia).toBeNull();
  });

  it('assembles a phone from the DDD and the subscriber number, and rejects a partial one', () => {
    expect(brPhone('11', '32145678')).toBe('+55 11 32145678');
    expect(brPhone('47', '988776655')).toBe('+55 47 988776655');
    // The register leaves one or both halves blank on most rows.
    expect(brPhone('', '32145678')).toBeNull();
    expect(brPhone('11', '')).toBeNull();
    expect(brPhone('11', '1234')).toBeNull();     // too short to be a real number
    expect(brPhone('011', '32145678')).toBeNull(); // a DDD is two digits
  });

  it('falls back to the second phone when the first is blank', () => {
    const r = toBrEstabRow(estab({ 21: '', 22: '', 23: '21', 24: '25551234' }));
    expect(r.phone).toBe('+55 21 25551234');
  });

  it('knows the 27 UF codes and nothing else', () => {
    for (const uf of ['SP', 'RJ', 'DF', 'AC', 'to']) expect(isBrazilianUf(uf), uf).toBe(true);
    for (const uf of ['XX', '', null, undefined, 'USA']) expect(isBrazilianUf(uf), String(uf)).toBe(false);
  });
});

describe('BR CNPJ vertical mapping', () => {
  it('maps every CNAE to a real vertical and excludes the ones that do not fit one', () => {
    expect(BR_CNAE_VERTICAL['6920601'].product).toBe('accounting');
    expect(BR_CNAE_VERTICAL['6821801'].product).toBe('realestate');
    expect(BR_CNAE_VERTICAL['8630504'].product).toBe('dental');
    expect(BR_CNAE_VERTICAL['4930202'].product).toBe('freight');
    expect(BR_CNAE_VERTICAL['4321500'].product).toBe('homeservices');
    expect(BR_CNAE_VERTICAL['7500100'].product).toBe('vets');
    expect(BR_CNAE_VERTICAL['8511200'].product).toBe('childcare');
    expect(BR_CNAE_VERTICAL['4923002'].product).toBe('taxi');
    // physio is 8650004/8650005 (fisioterapia / terapia ocupacional) — NOT
    // 8630503, which is general medical consulting rooms and fits no vertical.
    expect(cnaesForProduct('physio').sort()).toEqual(['8650004', '8650005']);
    expect(BR_CNAE_VERTICAL['8630503']).toBeUndefined();
    expect(BR_PRODUCT_IDS).toEqual(['accounting', 'childcare', 'dental', 'freight', 'homeservices', 'physio', 'realestate', 'taxi', 'vets']);
  });

  it('builds the mirror URLs for the resolved release', () => {
    expect(estabelecimentosUrl(1)).toBe(`https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos/${CNPJ_RELEASE}/Estabelecimentos1.zip`);
    expect(empresasUrl(0, '2026-10-14')).toBe('https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos/2026-10-14/Empresas0.zip');
  });
});

describe('BR CNPJ row evaluation', () => {
  it('keeps an active matriz with a business email and explains the score', () => {
    const ev = keep(evaluateBrEstabRow(toBrEstabRow(estab()), 'dental'));
    expect(ev.typeLabel).toBe('dental practice');
    expect(ev.usableEmail).toBe('contato@clinicasorriso.com.br');
    expect(ev.adjust).toBe(3 + 5 + 2 + 1);
    expect(ev.reasons.join(' ')).toMatch(/CNAE 8630504/);
    expect(ev.reasons.join(' ')).toMatch(/business-domain email/);
  });

  it('drops anything that is not situacao 02 (ativa)', () => {
    for (const s of ['01', '03', '04', '08', '']) {
      expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab({ 5: s })), 'dental')).reason).toMatch(/not 02 \(ativa\)/);
    }
  });

  it('drops a filial, so a chain collapses to one lead at its head office', () => {
    expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab({ 3: '2' })), 'dental')).reason).toMatch(/filial/);
  });

  it('drops establishments outside Brazil and rows with a non-Brazilian UF', () => {
    expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab({ 8: 'MIAMI' })), 'dental')).reason).toMatch(/outside Brazil/);
    expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab({ 9: '249' })), 'dental')).reason).toMatch(/outside Brazil/);
    // 105 is Brazil's own country code and must NOT be treated as foreign.
    keep(evaluateBrEstabRow(toBrEstabRow(estab({ 9: '105' })), 'dental'));
    expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab({ 19: 'XX' })), 'dental')).reason).toMatch(/not a Brazilian state/);
  });

  it('requires an email, and routes a row to its own vertical only', () => {
    expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab({ 27: '' })), 'dental')).reason).toMatch(/no email/);
    expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab()), 'accounting')).reason).toMatch(/belongs to the dental vertical/);
    expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab({ 11: '9999999' })), 'dental')).reason).toMatch(/not one of the mapped verticals/);
  });

  // THE CONTADOR RULE. A Brazilian company routinely registers its accountant's
  // address as the CNPJ contact, and one such address sits on hundreds of
  // unrelated companies.
  it('rejects an accountant\'s email for every vertical except accounting', () => {
    const contador = ['x@contabilidadesilva.com.br', 'y@escritoriocontabil.com', 'z@contabilexpress.com.br', 'w@jrcontadores.com.br'];
    for (const email of contador) {
      expect(looksLikeAccountantDomain(email), email).toBe(true);
      expect(rejected(evaluateBrEstabRow(toBrEstabRow(estab({ 27: email })), 'dental')).reason, email).toMatch(/accounting office/);
      // For the accounting vertical that same domain IS the business we want.
      keep(evaluateBrEstabRow(toBrEstabRow(estab({ 11: '6920601', 27: email })), 'accounting'));
    }
    // An ordinary business domain is untouched.
    expect(looksLikeAccountantDomain('contato@clinicasorriso.com.br')).toBe(false);
    expect(looksLikeAccountantDomain('a@conta.com.br')).toBe(false);
    expect(looksLikeAccountantDomain(null)).toBe(false);
  });

  it('treats the big Brazilian ISPs as free mail alongside the global providers', () => {
    for (const e of ['a@gmail.com', 'a@hotmail.com', 'a@bol.com.br', 'a@uol.com.br', 'a@terra.com.br', 'a@ig.com.br', 'a@yahoo.com.br']) {
      expect(isBrFreeMail(e), e).toBe(true);
    }
    // A real business domain that merely contains a provider's letters is not free mail.
    for (const e of ['a@clinicasorriso.com.br', 'a@bolsadeimoveis.com.br', 'a@iguacutransportes.com.br']) {
      expect(isBrFreeMail(e), e).toBe(false);
    }
    expect(isBrFreeMail('not-an-email')).toBe(false);
  });

  it('does not use a free-mail address as the contact, except for childcare', () => {
    const free = evaluateBrEstabRow(toBrEstabRow(estab({ 27: 'sorriso@gmail.com' })), 'dental');
    expect(keep(free).usableEmail).toBeNull();
    expect(keep(free).reasons.join(' ')).toMatch(/not used as the contact/);

    // childcare is the documented exception: a small creche genuinely runs on a
    // gmail address, and dropping those loses exactly the leads the vertical wants.
    const creche = keep(evaluateBrEstabRow(toBrEstabRow(estab({ 11: '8511200', 27: 'creche@gmail.com' })), 'childcare'));
    expect(creche.usableEmail).toBe('creche@gmail.com');
    expect(creche.reasons.join(' ')).toMatch(/kept: normal for a small creche/);
  });
});

describe('BR CNPJ company-side filters', () => {
  it('parses the comma-decimal capital_social', () => {
    expect(parseCapital('120000000000,00')).toBe(120000000000);
    expect(parseCapital('1.500.000,50')).toBe(1500000.5);
    expect(parseCapital('0,00')).toBe(0);
    expect(parseCapital('')).toBeNull();
    expect(parseCapital(null)).toBeNull();
  });

  it('maps an Empresas row and rejects one with no legal name', () => {
    expect(toBrEmpresa(['12345678', 'CLINICA SORRISO LTDA', '2062', '49', '50000,00', '01', ''])).toEqual({
      cnpjBasico: '12345678',
      empresa: { razaoSocial: 'CLINICA SORRISO LTDA', porte: '01', capital: 50000 },
    });
    expect(toBrEmpresa(['12345678', '', '2062'])).toBeNull();
  });

  it('uses porte and capital as the small-business filter, and stays permissive when unknown', () => {
    expect(isSmallBusiness({ razaoSocial: 'X LTDA', porte: '01', capital: 1000 }).ok).toBe(true);
    expect(isSmallBusiness({ razaoSocial: 'X LTDA', porte: '03', capital: 500000 }).ok).toBe(true);
    // porte 05 is "demais": everything above pequeno.
    expect(isSmallBusiness({ razaoSocial: 'X SA', porte: '05', capital: 0 })).toMatchObject({ ok: false, reason: /porte_empresa 05/ });
    expect(isSmallBusiness({ razaoSocial: 'X LTDA', porte: '01', capital: 120_000_000 })).toMatchObject({ ok: false, reason: /above the small-business ceiling/ });
    // No Empresas row: fall back to the name heuristics rather than dropping the lead.
    expect(isSmallBusiness(null).ok).toBe(true);
  });

  it('drops conglomerates and national chains by legal name, and keeps an ordinary LTDA', () => {
    const small: BrEmpresa = { razaoSocial: 'CLINICA SORRISO LTDA', porte: '01', capital: 50000 };
    expect(rejectOnCompany('Clinica Sorriso', small)).toBeNull();
    expect(rejectOnCompany('X', { ...small, razaoSocial: 'BANCO DO BRASIL SA' })).toMatch(/S\.A\.\/holding/);
    expect(rejectOnCompany('X', { ...small, razaoSocial: 'PATAGA PARTICIPACOES LTDA' })).toMatch(/S\.A\.\/holding/);
    expect(rejectOnCompany('X', { ...small, razaoSocial: 'ALFA HOLDING LTDA' })).toMatch(/S\.A\.\/holding/);
    expect(rejectOnCompany('Odontocompany Unidade 12', small)).toMatch(/national chain/);
    expect(rejectOnCompany('X', { ...small, razaoSocial: 'SORRIDENTS FRANQUIAS LTDA' })).toMatch(/chain|holding/);
    expect(rejectOnCompany('X', { ...small, razaoSocial: `A${'B'.repeat(120)} LTDA` })).toMatch(/characters/);
    // "CASA" and "SAUDE" contain "sa" but are not the S.A. legal form.
    expect(rejectOnCompany('X', { ...small, razaoSocial: 'CASA DE SAUDE BOM JESUS LTDA' })).toBeNull();
  });

  it('recognises an MEI registered under a personal name plus a CPF', () => {
    expect(looksLikeMei('IRENILDA OLIVEIRA SILVA 11338767810')).toBe(true);
    expect(looksLikeMei('32.066.824 MAIZA BARBOSA SANTANA')).toBe(true);
    expect(looksLikeMei('CLINICA SORRISO LTDA')).toBe(false);
  });
});

describe('BR CNPJ lead building', () => {
  const empresa: BrEmpresa = { razaoSocial: 'SORRISO SERVICOS ODONTOLOGICOS LTDA', porte: '03', capital: 80000 };

  it('builds a held Brazilian lead with the trade name, city and CNPJ', () => {
    const r = toBrEstabRow(estab());
    const lead = toBrLead(r, keep(evaluateBrEstabRow(r, 'dental')), empresa, MUNICIPALITIES.get('7107') ?? null);
    expect(lead.sourceKey).toBe('dental:br:12345678');
    expect(lead.name).toBe('Clinica Odonto Sorriso');
    expect(lead.legalName).toBe('SORRISO SERVICOS ODONTOLOGICOS LTDA');
    expect(lead.city).toBe('Sao Paulo');
    expect(lead.location).toBe('Sao Paulo, BR');
    expect(lead.state).toBe('SP');
    expect(lead.phone).toBe('+55 11 32145678');
    expect(lead.licenseId).toBe('12345678000190');
    expect(lead.country).toBe('BR');
    expect(lead.email).toBe('contato@clinicasorriso.com.br');
    // The description may state only what the register supports.
    expect(lead.description).toBe('Listed in the Receita Federal do Brasil CNPJ register as an active dental practice, based in Sao Paulo, BR.');
    expect(lead.signalDetail).toMatch(/CNPJ 12345678000190, CNAE 8630504/);
    // The location is what picks the draft language.
    expect(detectDraftLanguage(lead.location)).toEqual({ code: 'pt', name: 'Portuguese' });
  });

  it('falls back to the legal name when there is no trade name, and scores porte', () => {
    const r = toBrEstabRow(estab({ 4: '' }));
    const lead = toBrLead(r, keep(evaluateBrEstabRow(r, 'dental')), empresa, 'SAO PAULO');
    expect(lead.name).toBe('Sorriso Servicos Odontologicos Ltda');
    // The register's own upper-case spelling is kept as legalName (as frRge does
    // with nom_entreprise); registryLeadRow files it under signals.registry and
    // never lets it into a draft.
    expect(lead.legalName).toBe('SORRISO SERVICOS ODONTOLOGICOS LTDA');
    expect(lead.reasons.join(' ')).toMatch(/\+3: classified as an empresa de pequeno porte/);
    expect(toBrLead(r, keep(evaluateBrEstabRow(r, 'dental')), { ...empresa, porte: '01' }, 'SAO PAULO').reasons.join(' ')).toMatch(/microempresa/);
  });

  it('scores an MEI down instead of dropping it, and copes with an unknown municipality', () => {
    const r = toBrEstabRow(estab({ 20: '9999' }));
    const lead = toBrLead(r, keep(evaluateBrEstabRow(r, 'dental')), { razaoSocial: 'MARIA SOUZA 11122233344', porte: '01', capital: 0 }, null);
    expect(lead.reasons.join(' ')).toMatch(/-6: registered as an MEI/);
    expect(lead.city).toBeNull();
    // With no city the location is still the country, so the draft language holds.
    expect(lead.location).toBe('BR');
    expect(detectDraftLanguage(lead.location)).toBeNull();
  });

  it('carries a free-mail lead with no email and no domain, so enrichment resolves it later', () => {
    const r = toBrEstabRow(estab({ 27: 'sorriso@gmail.com' }));
    const lead = toBrLead(r, keep(evaluateBrEstabRow(r, 'dental')), empresa, 'SAO PAULO');
    expect(lead.email).toBeNull();
    expect(lead.contactSourceUrl).toBeNull();
    expect(brSourceKey('dental', '12345678')).toBe('dental:br:12345678');
  });
});

describe('BR CNPJ Empresas partition selection', () => {
  const parts: EmpresasPartition[] = [
    ['1', '00000000'], ['2', '04631961'], ['3', '09253554'], ['4', '13846068'], ['5', '18421567'],
    ['6', '22967211'], ['7', '27499601'], ['8', '32066824'], ['9', '36627969'], ['0', '41273589'],
  ].map(([i, from]) => ({ index: Number(i), url: `u${i}`, from, entry: {} as ZipEntry }));

  it('picks the single partition a key falls in', () => {
    expect(partitionsFor(parts, ['00000001']).map((p) => p.index)).toEqual([1]);
    expect(partitionsFor(parts, ['05000000']).map((p) => p.index)).toEqual([2]);
    // Exactly on a boundary belongs to that partition, not the one before it.
    expect(partitionsFor(parts, ['09253554']).map((p) => p.index)).toEqual([3]);
    expect(partitionsFor(parts, ['09253553']).map((p) => p.index)).toEqual([2]);
    // The tail file holds everything above the last boundary.
    expect(partitionsFor(parts, ['99999999']).map((p) => p.index)).toEqual([0]);
  });

  it('returns only the partitions actually needed, in file order', () => {
    expect(partitionsFor(parts, ['00000001', '37000000']).map((p) => p.index)).toEqual([1, 9]);
    expect(partitionsFor(parts, []).map((p) => p.index)).toEqual([]);
    // A key set spread across the register needs most of them — which is why the
    // join is the expensive half of a run.
    expect(partitionsFor(parts, ['00000001', '05000000', '10000000', '45000000'])).toHaveLength(4);
  });
});

describe('findBrCnpjCandidates', () => {
  it('scans supplied rows, keeps one lead per company and reports why the rest went', async () => {
    const rows = [
      estab(),                                        // kept
      estab({ 0: '22222222', 5: '08' }),              // baixada
      estab({ 0: '33333333', 3: '2' }),               // filial
      estab({ 0: '44444444', 27: '' }),               // no email
      estab({ 0: '55555555', 11: '6920601' }),        // another vertical
      estab({ 0: '66666666', 27: 'a@contabilidadex.com.br' }), // contador
      estab({ 0: '12345678' }),                       // duplicate company
      estab({ 0: '77777777', 4: 'ODONTO FELIZ' }),    // kept
    ];
    const res = await findBrCnpjCandidates('dental', 100, { rowsOverride: rows });
    expect(res.errors).toEqual([]);
    expect(res.scanned).toBe(8);
    expect(res.candidates.map((c) => c.sourceKey)).toEqual(['dental:br:12345678', 'dental:br:77777777']);
    expect(res.rejected).toMatchObject({
      'duplicate cnpj_basico': 1,
      'filial (branch establishment), not the matriz': 1,
      'no email published': 1,
    });
    expect(Object.keys(res.rejected).join(' ')).toMatch(/accounting office/);
    expect(res.complete).toBe(true);
    // Every lead is a Brazilian one, so every lead gets the hold.
    for (const c of res.candidates) expect(c.country).toBe('BR');
  });

  it('honours isKnown, the candidate cap and the row budget, and reports a resume point', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => estab({ 0: `1111111${i}`, 4: `CLINICA ${i}` }));
    const known = await findBrCnpjCandidates('dental', 100, { rowsOverride: rows, isKnown: (k) => k === 'dental:br:11111110' });
    expect(known.candidates).toHaveLength(5);
    expect(known.rejected['already known']).toBe(1);

    const capped = await findBrCnpjCandidates('dental', 2, { rowsOverride: rows });
    expect(capped.candidates).toHaveLength(2);

    const budgeted = await findBrCnpjCandidates('dental', 100, { rowsOverride: rows, maxRows: 3 });
    expect(budgeted.scanned).toBe(3);
    expect(budgeted.nextRow).toBe(3);
  });

  it('drops a row with neither a trade name nor a joined legal name', async () => {
    const res = await findBrCnpjCandidates('dental', 100, { rowsOverride: [estab({ 4: '' })] });
    expect(res.candidates).toEqual([]);
    expect(res.rejected['no nome fantasia and no razao social']).toBe(1);
  });

  it('reports a vertical it has no CNAE for instead of silently returning nothing', async () => {
    const res = await findBrCnpjCandidates('insurance', 10, { rowsOverride: [estab()] });
    expect(res.candidates).toEqual([]);
    expect(res.errors.join(' ')).toMatch(/no CNAE mapping for the insurance vertical/);
  });
});

// ---------------------------------------------------------------------------
// MEXICO — INEGI DENUE.
// ---------------------------------------------------------------------------
const DENUE_HEADER = [
  'id', 'clee', 'nom_estab', 'raz_social', 'codigo_act', 'nombre_act', 'per_ocu', 'tipo_vial', 'nom_vial',
  'numero_ext', 'cod_postal', 'cve_ent', 'entidad', 'cve_mun', 'municipio', 'telefono', 'correoelec', 'www',
  'tipoUniEco', 'latitud', 'longitud', 'fecha_alta',
];
function denue(over: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    id: '12299604', clee: '09015621211000012000000000U1', nom_estab: 'CONSULTORIO DENTAL SONRISA',
    raz_social: '', codigo_act: '621211', nombre_act: 'Consultorios dentales del sector privado',
    per_ocu: '0 a 5 personas', tipo_vial: 'CALLE', nom_vial: 'REFORMA', numero_ext: '120',
    cod_postal: '06600', cve_ent: '09', entidad: 'Ciudad de México', cve_mun: '015',
    municipio: 'Cuauhtémoc', telefono: '5555123456', correoelec: 'contacto@dentalsonrisa.mx',
    www: 'www.dentalsonrisa.mx', tipoUniEco: 'Fijo', latitud: '19.4', longitud: '-99.1', fecha_alta: '2020-11',
  };
  return DENUE_HEADER.map((h) => over[h] ?? base[h] ?? '');
}

describe('DENUE header and row parsing', () => {
  it('resolves columns by name, so a added or reordered column cannot shift the data', () => {
    const idx = denueHeaderIndex(DENUE_HEADER);
    expect(idx.correoelec).toBe(16);
    // Reordered: the same names still resolve, to different positions.
    const swapped = [...DENUE_HEADER];
    [swapped[2], swapped[16]] = [swapped[16], swapped[2]];
    expect(denueHeaderIndex(swapped).correoelec).toBe(2);
  });

  it('names the missing columns when the layout changes', () => {
    expect(() => denueHeaderIndex(DENUE_HEADER.filter((h) => h !== 'correoelec' && h !== 'per_ocu')))
      .toThrow(/missing per_ocu, correoelec|missing correoelec, per_ocu/);
  });

  it('maps a row and treats a blank field as absent', () => {
    const idx = denueHeaderIndex(DENUE_HEADER);
    const r = toDenueRow(denue(), idx);
    expect(r).toMatchObject({
      nomEstab: 'CONSULTORIO DENTAL SONRISA', razSocial: null, codigoAct: '621211',
      perOcu: '0 a 5 personas', telefono: '5555123456', correoelec: 'contacto@dentalsonrisa.mx',
      www: 'www.dentalsonrisa.mx', municipio: 'Cuauhtémoc',
    });
  });

  it('builds a per-state URL and rejects a code outside 01..32', () => {
    expect(denueUrl('09')).toBe('https://www.inegi.org.mx/contenidos/masiva/denue/denue_09_csv.zip');
    expect(denueUrl('1')).toBe('https://www.inegi.org.mx/contenidos/masiva/denue/denue_01_csv.zip');
    expect(() => denueUrl('00')).toThrow(/not an INEGI state code/);
    expect(() => denueUrl('33')).toThrow(/not an INEGI state code/);
    expect(MX_STATE_CODES).toHaveLength(32);
    expect(MX_STATE_CODES[0]).toBe('01');
    expect(MX_STATE_CODES[31]).toBe('32');
  });

  // Estado de México is the most populous state and is published as TWO archives;
  // denue_15_csv.zip does not exist. Treating it like the others would silently
  // lose the biggest state in the country.
  it('knows Estado de México is split into two archives, and every other state is one', () => {
    expect(denueUrls('15')).toEqual([
      'https://www.inegi.org.mx/contenidos/masiva/denue/denue_15_1_csv.zip',
      'https://www.inegi.org.mx/contenidos/masiva/denue/denue_15_2_csv.zip',
    ]);
    expect(DENUE_SPLIT_STATES['15']).toEqual([1, 2]);
    for (const s of MX_STATE_CODES.filter((c) => c !== '15')) expect(denueUrls(s), s).toHaveLength(1);
    // Every state resolves to at least one archive, so none is silently skipped.
    expect(MX_STATE_CODES.flatMap(denueUrls)).toHaveLength(33);
  });
});

describe('DENUE vertical mapping and filters', () => {
  it('maps the five SCIAN codes whose email fill makes a pass worthwhile', () => {
    expect(MX_SCIAN_VERTICAL['541211'].product).toBe('accounting');
    expect(MX_SCIAN_VERTICAL['531210'].product).toBe('realestate');
    expect(MX_SCIAN_VERTICAL['624411'].product).toBe('childcare');
    expect(MX_SCIAN_VERTICAL['541941'].product).toBe('vets');
    expect(MX_SCIAN_VERTICAL['621211'].product).toBe('dental');
    expect(MX_PRODUCT_IDS).toEqual(['accounting', 'childcare', 'dental', 'realestate', 'vets']);
    expect(scianForProduct('dental')).toEqual(['621211']);
    // Salons, funeral and hardware are left out at 6-12% email fill.
    for (const c of ['812110', '812310', '467111']) expect(MX_SCIAN_VERTICAL[c]).toBeUndefined();
  });

  it('drops only the two largest headcount bands', () => {
    for (const b of ['101 a 250 personas', '251 y más personas']) expect(isBigHeadcount(b), b).toBe(true);
    for (const b of ['0 a 5 personas', '6 a 10 personas', '11 a 30 personas', '31 a 50 personas', '51 a 100 personas', '', null]) {
      expect(isBigHeadcount(b), String(b)).toBe(false);
    }
  });

  it('treats the Mexican ISPs as free mail', () => {
    for (const e of ['a@gmail.com', 'a@hotmail.com', 'a@prodigy.net.mx', 'a@yahoo.com.mx']) expect(isMxFreeMail(e), e).toBe(true);
    expect(isMxFreeMail('a@dentalsonrisa.mx')).toBe(false);
  });

  it('spots the generic activity description INEGI writes when a unit has no trade name', () => {
    expect(isGenericName('Consultorios dentales del sector privado', 'Consultorios dentales del sector privado')).toBe(true);
    expect(isGenericName('CONSULTORIOS DENTALES DEL SECTOR PRIVADO', 'Consultorios dentales del sector privado')).toBe(true);
    expect(isGenericName('CONSULTORIO DENTAL SONRISA', 'Consultorios dentales del sector privado')).toBe(false);
    expect(isGenericName(null, 'x')).toBe(false);
  });

  it('normalises the published website to a domain, and never mistakes a mail host for one', () => {
    expect(denueDomain('www.dentalsonrisa.mx')).toBe('dentalsonrisa.mx');
    expect(denueDomain('http://dentalsonrisa.com.mx/inicio')).toBe('dentalsonrisa.com.mx');
    expect(denueDomain('HTTPS://WWW.Dental.MX?a=1')).toBe('dental.mx');
    expect(denueDomain('gmail.com')).toBeNull();
    expect(denueDomain('no dispone')).toBeNull();
    expect(denueDomain('')).toBeNull();
    expect(denueDomain(null)).toBeNull();
  });
});

describe('DENUE row evaluation and lead building', () => {
  const idx = denueHeaderIndex(DENUE_HEADER);
  const row = (over: Record<string, string> = {}) => toDenueRow(denue(over), idx);

  it('keeps a small private practice with a business email and explains the score', () => {
    const ev = keep(evaluateDenueRow(row(), 'dental'));
    expect(ev.typeLabel).toBe('dental practice');
    expect(ev.name).toBe('CONSULTORIO DENTAL SONRISA');
    expect(ev.usableEmail).toBe('contacto@dentalsonrisa.mx');
    expect(ev.adjust).toBe(3 + 5 + 3 + 2 + 2);
  });

  it('requires an email, which is the whole point of the source', () => {
    expect(rejected(evaluateDenueRow(row({ correoelec: '' }), 'dental')).reason).toMatch(/no email/);
  });

  it('drops the large headcount bands, chains and generic-named units', () => {
    expect(rejected(evaluateDenueRow(row({ per_ocu: '251 y más personas' }), 'dental')).reason).toMatch(/headcount band/);
    expect(rejected(evaluateDenueRow(row({ nom_estab: 'DENTALIA POLANCO' }), 'dental')).reason).toMatch(/national chain/);
    expect(rejected(evaluateDenueRow(row({ nom_estab: 'X', raz_social: 'KPMG CARDENAS DOSAL SC', codigo_act: '541211' }), 'accounting')).reason).toMatch(/national chain/);
    expect(rejected(evaluateDenueRow(row({ nom_estab: 'Consultorios dentales del sector privado' }), 'dental')).reason).toMatch(/generic activity description/);
    // ...unless a raz_social supplies a real name.
    expect(keep(evaluateDenueRow(row({ nom_estab: 'Consultorios dentales del sector privado', raz_social: 'SONRISA SA DE CV' }), 'dental')).name).toBe('SONRISA SA DE CV');
  });

  it('routes a row only to its own vertical', () => {
    expect(rejected(evaluateDenueRow(row(), 'accounting')).reason).toMatch(/belongs to the dental vertical/);
    expect(rejected(evaluateDenueRow(row({ codigo_act: '999999' }), 'dental')).reason).toMatch(/not one of the mapped verticals/);
  });

  it('does not use a free-mail address as the contact, except for childcare', () => {
    expect(keep(evaluateDenueRow(row({ correoelec: 'dental@hotmail.com' }), 'dental')).usableEmail).toBeNull();
    const g = keep(evaluateDenueRow(row({ codigo_act: '624411', nombre_act: 'Guarderías del sector privado', correoelec: 'guarderia@hotmail.com' }), 'childcare'));
    expect(g.usableEmail).toBe('guarderia@hotmail.com');
    expect(g.reasons.join(' ')).toMatch(/small guarder/);
  });

  it('builds a held Mexican lead with the municipality, the CLEE and the published domain', () => {
    const r = row();
    const lead = toDenueLead(r, keep(evaluateDenueRow(r, 'dental')), '09015621211000012000000000U1');
    expect(lead.sourceKey).toBe('dental:mx:09015621211000012000000000U1');
    expect(lead.name).toBe('Consultorio Dental Sonrisa');
    expect(lead.city).toBe('Cuauhtémoc');
    expect(lead.location).toBe('Cuauhtémoc, MX');
    expect(lead.country).toBe('MX');
    expect(lead.domain).toBe('dentalsonrisa.mx');
    expect(lead.licenseId).toBe('09015621211000012000000000U1');
    expect(lead.description).toBe("Listed in the INEGI DENUE (Mexico's national directory of economic units) as a dental practice, based in Cuauhtémoc, MX.");
    expect(lead.signalDetail).toMatch(/DENUE CLEE 09015621211000012000000000U1, SCIAN 621211/);
    expect(detectDraftLanguage(lead.location)).toEqual({ code: 'es', name: 'Spanish' });
    expect(denueSourceKey('vets', 'abc')).toBe('vets:mx:abc');
  });
});

describe('findDenueCandidates', () => {
  it('reads the header, keeps matching rows and counts the rest by reason', async () => {
    const rows = [
      DENUE_HEADER,
      denue(),                                                                 // kept
      denue({ clee: 'B', correoelec: '' }),                                    // no email
      denue({ clee: 'C', per_ocu: '251 y más personas' }),                     // too big
      denue({ clee: 'D', codigo_act: '541211' }),                              // another vertical
      denue({ clee: 'E', nom_estab: 'DENTALIA SUR' }),                         // chain
      denue(),                                                                 // duplicate CLEE
      denue({ clee: 'G', nom_estab: 'DENTAL DEL VALLE' }),                     // kept
    ];
    const res = await findDenueCandidates('dental', 100, { rowsOverride: rows, states: ['09'] });
    expect(res.errors).toEqual([]);
    expect(res.scanned).toBe(7);
    expect(res.candidates.map((c) => c.name)).toEqual(['Consultorio Dental Sonrisa', 'Dental Del Valle']);
    expect(res.rejected).toMatchObject({ 'no email published': 1, 'duplicate CLEE': 1 });
    expect(res.byState['09']).toEqual({ scanned: 7, candidates: 2 });
    for (const c of res.candidates) expect(c.country).toBe('MX');
  });

  it('honours isKnown and the candidate cap', async () => {
    const rows = [DENUE_HEADER, denue({ clee: 'A' }), denue({ clee: 'B' }), denue({ clee: 'C' })];
    const known = await findDenueCandidates('dental', 100, { rowsOverride: rows, isKnown: (k) => k === 'dental:mx:A' });
    expect(known.candidates.map((c) => c.sourceKey)).toEqual(['dental:mx:B', 'dental:mx:C']);
    expect((await findDenueCandidates('dental', 1, { rowsOverride: rows })).candidates).toHaveLength(1);
  });

  it('reports a vertical it has no SCIAN code for', async () => {
    const res = await findDenueCandidates('freight', 10, { rowsOverride: [DENUE_HEADER, denue()] });
    expect(res.errors.join(' ')).toMatch(/no SCIAN mapping for the freight vertical/);
  });
});

// ---------------------------------------------------------------------------
// The hold, and the pipeline registration.
// ---------------------------------------------------------------------------
describe('the Brazilian and Mexican international hold', () => {
  it('stores every BR and MX lead region_blocked with signals.intlHold', async () => {
    const { registryLeadRow } = await import('@/lib/outreach/discovery/pipeline');
    const now = '2026-09-24T12:00:00.000Z';

    const br = toBrEstabRow(estab());
    const brLead = toBrLead(br, keep(evaluateBrEstabRow(br, 'dental')), { razaoSocial: 'SORRISO LTDA', porte: '01', capital: 1000 }, 'SAO PAULO');
    const brRow = registryLeadRow(brLead, dental, now);
    expect(brRow.fields.region_blocked).toBe(true);
    expect(brRow.fields.signals.intlHold).toEqual({ country: 'BR', reason: INTL_HOLD_REASON });
    // The email is found, so the lead is ready the moment Brazil is released.
    expect(brRow.fields.contact_status).toBe('found');
    expect(brRow.fields.domain).toBe('clinicasorriso.com.br');

    const idx = denueHeaderIndex(DENUE_HEADER);
    const mx = toDenueRow(denue(), idx);
    const mxLead = toDenueLead(mx, keep(evaluateDenueRow(mx, 'dental')), 'CLEE1');
    const mxRow = registryLeadRow(mxLead, dental, now);
    expect(mxRow.fields.region_blocked).toBe(true);
    expect(mxRow.fields.signals.intlHold).toEqual({ country: 'MX', reason: INTL_HOLD_REASON });
    expect(mxRow.fields.domain).toBe('dentalsonrisa.mx');

    // A free-mail BR lead is held too, and carries no email and no domain, so
    // enrichment would have to resolve it — after the country is released.
    const freeBr = toBrEstabRow(estab({ 27: 'sorriso@gmail.com' }));
    const freeRow = registryLeadRow(toBrLead(freeBr, keep(evaluateBrEstabRow(freeBr, 'dental')), null, 'SAO PAULO'), dental, now);
    expect(freeRow.fields.region_blocked).toBe(true);
    expect(freeRow.fields.contact_status).toBeUndefined();
    expect(freeRow.fields.domain).toBeNull();
  });

  it('registers br-cnpj and mx-denue for bulk import on the right verticals, leaving the existing sources alone', async () => {
    const { BULK_REGISTRY_SOURCE_IDS, bulkRegistrySourcesFor } = await import('@/lib/outreach/discovery/pipeline');
    expect(BULK_REGISTRY_SOURCE_IDS).toContain('br-cnpj');
    expect(BULK_REGISTRY_SOURCE_IDS).toContain('mx-denue');

    for (const p of [accounting, realestate, dental, childcare, physio, vets, taxi, freight, homeservices]) {
      expect(bulkRegistrySourcesFor(p), p.id).toContain('br-cnpj');
    }
    for (const p of [accounting, realestate, dental, childcare, vets]) {
      expect(bulkRegistrySourcesFor(p), p.id).toContain('mx-denue');
    }
    // DENUE has no code for these, so it must not be offered for them.
    for (const p of [physio, taxi, freight, homeservices]) {
      expect(bulkRegistrySourcesFor(p), p.id).not.toContain('mx-denue');
    }
    // The existing international and US sources are untouched.
    expect(bulkRegistrySourcesFor(homeservices)).toEqual(expect.arrayContaining(['nyc-dob', 'va-dpor', 'ar-clb', 'fr-rge']));
    expect(bulkRegistrySourcesFor(dental)).toEqual(expect.arrayContaining(['uk-cqc', 'no-brreg']));
  });
});
