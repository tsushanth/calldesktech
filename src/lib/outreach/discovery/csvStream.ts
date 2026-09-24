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
      if (ch === ',') { this.row.push(this.field); this.field = ''; continue; }
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
export function parseCsv(text: string): string[][] {
  const p = new CsvRowParser();
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
