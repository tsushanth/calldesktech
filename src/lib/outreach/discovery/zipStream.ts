import { DISCOVERY_UA } from './http';

// STREAMING READER FOR REMOTE ZIP ARCHIVES.
//
// The two Latin-American registry sources are both "one huge zip over HTTP":
//
//   * Receita Federal CNPJ open data (Brazil): Estabelecimentos{0..9}.zip, each
//     ~320-350 MB compressed and ~1 GB of ';'-separated Latin-1 CSV inside, plus
//     Empresas{0..9}.zip for the legal name. One member per archive, no header row.
//   * INEGI DENUE (Mexico): denue_{01..32}_csv.zip, 6-45 MB each, THREE members
//     (a data dictionary, the data CSV, and a metadata text file), comma CSV with
//     a header row, also Latin-1.
//
// Neither may ever touch the disk: the mini has a couple of GB free, and a single
// uncompressed Estabelecimentos member is larger than that. So nothing is
// downloaded as a file — the response body is inflated and parsed as it arrives,
// a visitor is called per row, and the caller keeps only the handful of rows it
// wants (exactly the shape delimitedStream.streamDelimitedRows uses for the
// plain-CSV sources).
//
// Implemented with node:zlib's raw-deflate stream over the zip's own structure
// rather than an unzip library, deliberately: the web app's `npm ci` must keep
// working, so NOTHING may be added to the root package.json. `node:zlib` and
// `node:stream` are imported LAZILY inside the functions below so that merely
// importing this module (which pipeline.ts does) never pulls a node builtin into
// a Next.js client or edge bundle.
//
// Why the CENTRAL DIRECTORY and not sequential local headers: DENUE's members
// are written with the data-descriptor flag set (bit 3), which means the local
// header's compressed size is 0 and you cannot find the next member without
// inflating the current one. Both hosts support byte ranges (verified live
// 2026-09-24), so the central directory at the tail gives every member's exact
// offset and size in two small requests, and the wanted member is then fetched
// on its own. That also means the 2.1 GB Estabelecimentos0.zip costs nothing to
// inspect.

export interface ZipEntry {
  name: string;
  // 0 = stored, 8 = deflate. Anything else is unsupported.
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  // Offset of the member's LOCAL header within the archive.
  offset: number;
}

// End-of-central-directory record: 22 bytes, plus a comment of up to 65535.
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

async function fetchRange(url: string, from: number, to: number, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DISCOVERY_UA, Accept: '*/*', Range: `bytes=${from}-${to}` },
      signal: controller.signal,
      redirect: 'follow',
    });
    // 206 is what a range request should return; a 200 means the server ignored
    // the range and is sending the whole archive, which for a 2 GB file would be
    // a disaster, so it is refused rather than silently tolerated.
    if (res.status !== 206) {
      try { await res.body?.cancel(); } catch { /* already closed */ }
      throw new Error(`${url}: byte ranges not honoured (HTTP ${res.status}); cannot read this archive without downloading it`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function zipSize(url: string, timeoutMs = 60_000): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': DISCOVERY_UA }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`${url} unavailable (HTTP ${res.status})`);
    const len = Number(res.headers.get('content-length'));
    if (!Number.isFinite(len) || len <= 0) throw new Error(`${url}: no content-length, so the central directory cannot be located`);
    return len;
  } finally {
    clearTimeout(timer);
  }
}

// Parses a central directory that has already been read into memory. Split out
// from the network so it can be unit tested against a fixture archive.
export function parseCentralDirectory(cd: Buffer, count: number): ZipEntry[] {
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CD_SIG) break;
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    out.push({
      name: cd.subarray(p + 46, p + 46 + nameLen).toString('latin1'),
      method: cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      uncompressedSize: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Locates the EOCD in an archive tail and returns the central directory's extent.
export function findEocd(tail: Buffer): { count: number; size: number; offset: number } {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue;
    return { count: tail.readUInt16LE(i + 10), size: tail.readUInt32LE(i + 12), offset: tail.readUInt32LE(i + 16) };
  }
  throw new Error('zip end-of-central-directory record not found in the archive tail');
}

// Two small range requests: the last 64 KB (enough for the EOCD plus any
// comment), then the central directory itself.
export async function listZipEntries(url: string, timeoutMs = 60_000): Promise<{ total: number; entries: ZipEntry[] }> {
  const total = await zipSize(url, timeoutMs);
  const tailLen = Math.min(66_000, total);
  const tail = await fetchRange(url, total - tailLen, total - 1, timeoutMs);
  const eocd = findEocd(tail);
  if (!eocd.size || eocd.offset + eocd.size > total) throw new Error(`${url}: central directory extent (${eocd.offset}+${eocd.size}) does not fit the ${total}-byte archive`);
  const cd = await fetchRange(url, eocd.offset, eocd.offset + eocd.size - 1, timeoutMs);
  const entries = parseCentralDirectory(cd, eocd.count);
  if (!entries.length) throw new Error(`${url}: central directory listed no members`);
  return { total, entries };
}

// ---- delimited rows -------------------------------------------------------
//
// csvStream.CsvRowParser is comma-only and delimitedStream adds tab; the CNPJ
// files are semicolon-separated. Rather than grow a delimiter flag on either
// shared parser (both are used by the US sources and by another workstream), the
// same RFC-4180 logic lives here parameterised by delimiter.
export class DelimitedRowParser {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  private quoteJustClosed = false;

  constructor(private readonly delimiter: string) {
    if (delimiter.length !== 1) throw new Error('delimiter must be a single character');
  }

  feed(chunk: string): string[][] {
    const out: string[][] = [];
    for (const ch of chunk) {
      if (this.inQuotes) {
        if (this.quoteJustClosed) {
          this.quoteJustClosed = false;
          if (ch === '"') { this.field += '"'; continue; } // escaped ""
          this.inQuotes = false;
          // fall through: ch is an ordinary character (usually the delimiter)
        } else if (ch === '"') {
          this.quoteJustClosed = true;
          continue;
        } else {
          this.field += ch;
          continue;
        }
      }
      if (ch === '"' && this.field === '') { this.inQuotes = true; continue; }
      if (ch === this.delimiter) { this.row.push(this.field); this.field = ''; continue; }
      if (ch === '\n') { this.row.push(this.field); out.push(this.row); this.row = []; this.field = ''; continue; }
      if (ch === '\r') continue;
      this.field += ch;
    }
    return out;
  }

  end(): string[] | null {
    if (this.inQuotes) { this.inQuotes = false; this.quoteJustClosed = false; }
    if (!this.row.length && this.field === '') return null;
    this.row.push(this.field);
    const r = this.row;
    this.row = [];
    this.field = '';
    return r;
  }
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const p = new DelimitedRowParser(delimiter);
  const rows = p.feed(text);
  const last = p.end();
  if (last) rows.push(last);
  return rows;
}

export interface ZipRowOptions {
  url: string;
  entry: ZipEntry;
  delimiter: string;
  // Both Latin-American sources are Latin-1; decoding them as UTF-8 turns every
  // accented business name into replacement characters.
  encoding?: string;
  // Called per row, in file order. Return false to stop: the response body is
  // cancelled and the inflate stream destroyed, so a 5% prefix really does
  // transfer only 5%.
  onRow: (row: string[], index: number) => boolean | void;
  // Caps how much COMPRESSED data is requested. This is what makes a partial
  // pass cheap: the Range request simply ends early. A truncated deflate stream
  // errors, which is expected and swallowed (see `truncated` below).
  maxCompressedBytes?: number;
  // Skip this many compressed bytes' worth of rows... not possible mid-deflate,
  // so resumption is by ROW INDEX instead: rows before `startRow` are inflated
  // and parsed but not handed to onRow. Cheap relative to the download.
  startRow?: number;
  timeoutMs?: number;
  log?: (m: string) => void;
}

// Inflates one zip member straight from the network and calls back per row.
// Nothing larger than a chunk is ever held, and nothing is written to disk.
export async function streamZipRows(opts: ZipRowOptions): Promise<{ scanned: number; delivered: number; truncated: boolean }> {
  const { entry } = opts;
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`${opts.url}: member "${entry.name}" uses unsupported compression method ${entry.method}`);
  }
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;

  // The local header repeats the name and extra fields, and the extra field
  // length can differ from the central directory's, so the data offset has to be
  // read from the local header itself.
  const head = await fetchRange(opts.url, entry.offset, entry.offset + 64, 60_000);
  if (head.readUInt32LE(0) !== LOCAL_SIG) throw new Error(`${opts.url}: no local header at offset ${entry.offset} for "${entry.name}"`);
  const dataStart = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);

  const want = Math.min(entry.compressedSize, opts.maxCompressedBytes ?? entry.compressedSize);
  const truncated = want < entry.compressedSize;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const zlib = await import('node:zlib');
  const { Readable } = await import('node:stream');

  let scanned = 0;
  let delivered = 0;
  let stopped = false;
  try {
    const res = await fetch(opts.url, {
      headers: { 'User-Agent': DISCOVERY_UA, Accept: '*/*', Range: `bytes=${dataStart}-${dataStart + want - 1}` },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.body || (res.status !== 206 && res.status !== 200)) {
      throw new Error(`${opts.url}: member fetch did not honour the byte range (HTTP ${res.status})`);
    }
    // A range that spans essentially the whole object is answered 200 with the
    // WHOLE FILE by the CDN in front of the CNPJ mirror (Cloudflare does this for
    // the 563 MB Empresas0.zip, and for any full-file member read). The bytes are
    // the ones we want, but they start at offset 0 instead of at the member's
    // data, so the local header has to be skipped by hand before the inflater
    // sees anything. Refusing instead would make a full-file pass impossible.
    let skip = res.status === 200 ? dataStart : 0;
    if (skip) opts.log?.(`${opts.url}: server answered 200 to a whole-object range; skipping the first ${skip} bytes to reach "${entry.name}"`);

    const decoder = new TextDecoder(opts.encoding ?? 'latin1');
    const parser = new DelimitedRowParser(opts.delimiter);
    const startRow = opts.startRow ?? 0;
    const take = (row: string[]) => {
      // A trailing blank line is not a row.
      if (row.length === 1 && row[0] === '') return;
      const index = scanned++;
      if (index < startRow) return;
      delivered++;
      if (opts.onRow(row, index) === false) stopped = true;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source = Readable.fromWeb(res.body as any);
    const inflate = entry.method === 8 ? zlib.createInflateRaw() : null;
    // Drops the leading `skip` bytes (the archive prefix a 200 response includes)
    // so whatever follows starts exactly at the member's compressed data. A
    // no-op when the server honoured the range, which is the normal case.
    const { Transform } = await import('node:stream');
    const trim = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (skip <= 0) { cb(null, chunk); return; }
        if (chunk.length <= skip) { skip -= chunk.length; cb(); return; }
        const rest = chunk.subarray(skip);
        skip = 0;
        cb(null, rest);
      },
    });
    source.pipe(trim);
    const rows = inflate ? (trim.pipe(inflate), inflate) : trim;
    try {
      for await (const chunk of rows as AsyncIterable<Buffer>) {
        for (const row of parser.feed(decoder.decode(chunk, { stream: true }))) {
          take(row);
          if (stopped) break;
        }
        if (stopped) break;
      }
    } catch (e) {
      // A deliberately truncated member cannot end cleanly. Nor can a whole-object
      // 200 response, whose body continues past the member into the next local
      // header and the central directory: the inflater reaches the end of the
      // deflate stream and then sees trailing bytes. Both are expected; anything
      // else, or a failure before a single row was read, is real.
      const benign = truncated || stopped || (res.status === 200 && scanned > 0);
      if (!benign) throw e;
    } finally {
      source.destroy();
      trim.destroy();
      inflate?.destroy();
      try { await res.body.cancel(); } catch { /* already consumed or destroyed */ }
    }
    if (!stopped && !truncated) {
      const last = parser.end();
      if (last) take(last);
    }
    opts.log?.(`${entry.name}: ${scanned} rows read${truncated ? ` (first ${want} of ${entry.compressedSize} compressed bytes)` : ''}`);
    return { scanned, delivered, truncated };
  } finally {
    clearTimeout(timer);
  }
}

// Picks the member a source wants by name pattern, with a clear error naming
// what the archive actually holds so a layout change is obvious.
export function pickZipEntry(entries: ZipEntry[], pattern: RegExp, url = 'archive'): ZipEntry {
  const hit = entries.filter((e) => pattern.test(e.name) && e.uncompressedSize > 0);
  if (!hit.length) throw new Error(`${url}: no member matching ${pattern} (members: ${entries.map((e) => e.name).join(', ')})`);
  // The largest match is the data file; DENUE's dictionary would otherwise win a
  // loose pattern.
  return hit.sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0];
}
