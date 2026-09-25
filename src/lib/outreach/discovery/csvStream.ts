// Minimal, dependency-free streaming CSV reader for the bulk registry files
// (currently the 26 MB Florida DFS licensee export). It is deliberately small:
// RFC-4180 quoting, CRLF or LF, fed chunk by chunk so a large file never has to
// be held in memory as one string.

export class CsvRowParser {
  private buf = '';
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  private quoteJustClosed = false;
  // The field separator. Defaults to ',' so every existing caller is byte-for-byte
  // unchanged. The international exports use ';': the French funeral-operator list
  // and the three Tourisme Québec accommodation files are BOTH semicolon-separated
  // and RFC-4180 quoted (Québec quotes every field; France quotes only the fields
  // that contain a literal `"`, of which there are a handful), so they need this
  // parser's quote handling with a different separator, not a second parser.
  private readonly sep: string;

  constructor(separator = ',') {
    if (separator.length !== 1 || separator === '"' || separator === '\n' || separator === '\r') {
      throw new Error(`invalid CSV separator ${JSON.stringify(separator)}`);
    }
    this.sep = separator;
  }

  // Feed one decoded chunk; returns the rows completed by it.
  feed(chunk: string): string[][] {
    this.buf += chunk;
    const out: string[][] = [];
    for (const ch of this.buf) {
      if (this.inQuotes) {
        if (this.quoteJustClosed) {
          this.quoteJustClosed = false;
          if (ch === '"') { this.field += '"'; continue; } // escaped ""
          this.inQuotes = false;
          // fall through and handle ch as an ordinary character
        } else if (ch === '"') {
          this.quoteJustClosed = true;
          continue;
        } else {
          this.field += ch;
          continue;
        }
      }
      if (ch === '"' && this.field === '') { this.inQuotes = true; continue; }
      if (ch === this.sep) { this.row.push(this.field); this.field = ''; continue; }
      if (ch === '\n') { this.row.push(this.field); out.push(this.row); this.row = []; this.field = ''; continue; }
      if (ch === '\r') continue;
      this.field += ch;
    }
    this.buf = '';
    return out;
  }

  // Any trailing row not terminated by a newline.
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

// Convenience for tests and small strings.
export function parseCsv(text: string, separator = ','): string[][] {
  const p = new CsvRowParser(separator);
  const rows = p.feed(text);
  const last = p.end();
  if (last) rows.push(last);
  return rows;
}

// Excel "formula guard" cells used throughout the FL DFS export: `="7410936"` -> `7410936`.
export function unwrapCell(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  const m = /^="(.*)"$/.exec(v);
  return (m ? m[1] : v).trim();
}

export function rowToObject(header: string[], row: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) o[header[i]] = unwrapCell(row[i]);
  return o;
}
