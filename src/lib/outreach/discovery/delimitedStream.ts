import { CsvRowParser, unwrapCell } from './csvStream';
import { DISCOVERY_UA } from './http';

// Streaming reader for the batch-2 bulk registry files, which are all "one big
// delimited download" but differ in every other respect:
//
//  * Virginia DPOR regulant lists are TAB-delimited with no quoting at all (a
//    quote character inside a business name is just a character), so they cannot
//    go through the RFC-4180 CsvRowParser.
//  * The Arkansas contractor roster is a comma CSV whose real header is NOT the
//    first line: the export starts with a title line ("CLB Roster Export - ...")
//    and a blank line.
//  * The California CDPH facility file is a plain comma CSV with a first-line
//    header, but it is 7 MB and only ~4k of its 15k rows are wanted.
//
// So: one fetch + decode + row-split pipeline, a visitor called per row, and the
// header found by looking for the first row that actually contains the columns
// the caller needs. Nothing is accumulated here — the caller keeps only the rows
// it wants, the way flDfsRegistry.streamFlDfsRows does.

// Tab-delimited rows, no quoting. Kept separate from CsvRowParser so neither
// has to grow a mode flag.
export class TabRowParser {
  private field = '';
  private row: string[] = [];

  feed(chunk: string): string[][] {
    const out: string[][] = [];
    for (const ch of chunk) {
      if (ch === '\t') { this.row.push(this.field); this.field = ''; continue; }
      if (ch === '\n') { this.row.push(this.field); out.push(this.row); this.row = []; this.field = ''; continue; }
      if (ch === '\r') continue;
      this.field += ch;
    }
    return out;
  }

  end(): string[] | null {
    if (!this.row.length && this.field === '') return null;
    this.row.push(this.field);
    const r = this.row;
    this.row = [];
    this.field = '';
    return r;
  }
}

export interface RowParser {
  feed(chunk: string): string[][];
  end(): string[] | null;
}

// 'semicolon' is what the international exports use — France's funeral-operator
// list and the three Tourisme Québec accommodation files. Both are semicolon-
// separated AND RFC-4180 quoted (Québec quotes every field; France quotes only the
// fields containing a literal `"`), so they go through CsvRowParser with a
// different separator rather than through the unquoted TabRowParser.
export type Delimiter = 'tab' | 'comma' | 'semicolon';

export function makeRowParser(delimiter: Delimiter): RowParser {
  if (delimiter === 'tab') return new TabRowParser();
  return new CsvRowParser(delimiter === 'semicolon' ? ';' : ',');
}

// Header detection: the first row that contains every required column. Anything
// before it (title lines, blank lines) is discarded. Returns null while still
// looking, so a layout change surfaces as "header not found" rather than as
// silently empty output.
export function findHeader(raw: string[], required: string[]): string[] | null {
  const cells = raw.map((c) => unwrapCell(c).trim());
  const upper = new Set(cells.map((c) => c.toUpperCase()));
  return required.every((c) => upper.has(c.toUpperCase())) ? cells : null;
}

// Values are trimmed; keys are the header cells verbatim. Trailing columns
// missing from a short row read as ''. (Virginia rows pad specialty codes with
// spaces, and Arkansas rows sometimes stop early.)
export function mapRow(header: string[], row: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) o[header[i]] = unwrapCell(row[i]).trim();
  return o;
}

export interface StreamOptions {
  url: string;
  delimiter: Delimiter;
  // Virginia and Arkansas are not UTF-8 (single-byte, with the odd accented
  // name); decoding them as UTF-8 produces replacement characters in names that
  // website discovery then cannot match.
  encoding?: string;
  requiredColumns: string[];
  // Called for every data row. Return false to stop reading (the response body
  // is cancelled), which is how a per-run window avoids downloading 22 MB.
  onRow: (row: Record<string, string>, index: number) => boolean | void;
  timeoutMs?: number;
  // The fetched body is only trusted if it is long enough and the header is
  // found; a proxy error page fails both.
  minRows?: number;
  log?: (m: string) => void;
}

export async function streamDelimitedRows(opts: StreamOptions): Promise<{ scanned: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  try {
    const res = await fetch(opts.url, {
      headers: { 'User-Agent': DISCOVERY_UA, Accept: '*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok || !res.body) throw new Error(`${opts.url} unavailable (HTTP ${res.status})`);
    const decoder = new TextDecoder(opts.encoding ?? 'utf-8');
    const parser = makeRowParser(opts.delimiter);
    let header: string[] | null = null;
    let scanned = 0;
    let stopped = false;
    const take = (raw: string[]) => {
      if (stopped) return;
      if (!header) {
        // A blank or short leading line is not a header candidate.
        if (raw.length > 1) header = findHeader(raw, opts.requiredColumns);
        return;
      }
      const o = mapRow(header, raw);
      // Delimited exports commonly end with a blank final line.
      if (Object.values(o).every((v) => v === '')) return;
      const keep = opts.onRow(o, scanned);
      scanned++;
      if (keep === false) stopped = true;
    };
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) for (const raw of parser.feed(decoder.decode(value, { stream: true }))) take(raw);
      if (stopped) { await reader.cancel().catch(() => {}); break; }
    }
    if (!stopped) {
      const last = parser.end();
      if (last) take(last);
    }
    if (!header) throw new Error(`${opts.url}: header row with ${opts.requiredColumns.join(', ')} not found; file layout may have changed`);
    if (!stopped && scanned < (opts.minRows ?? 50)) throw new Error(`${opts.url}: only ${scanned} rows; file layout may have changed`);
    opts.log?.(`streamed ${scanned} rows from ${opts.url}`);
    return { scanned };
  } finally {
    clearTimeout(timer);
  }
}
