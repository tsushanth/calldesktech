// Dedup rules so the daily run never re-adds, re-enriches, or re-drafts the
// same agency. Matching is layered, strongest first:
//   1. source_key   ("retell:<slug>")  - exact identity from the directory
//   2. compact name ("Tempo Flows" == "TempoFlows" == "Action2Call(TM)")
//   3. domain       (two listings that resolve to the same website)
// The DB also enforces a unique index on source_key (migration 029).

const CORP_SUFFIX = /\b(inc|llc|llp|ltd|gmbh|corp|corporation|co|company|pty|plc)\b\.?/g;

export function compactName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(CORP_SUFFIX, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface LeadKeyRow {
  id: string;
  company_name: string;
  domain?: string | null;
  source_key?: string | null;
}

export class LeadIndex<T extends LeadKeyRow> {
  private byKey = new Map<string, T>();
  private byName = new Map<string, T>();
  private byDomain = new Map<string, T>();

  constructor(rows: T[]) {
    for (const row of rows) this.add(row);
  }

  add(row: T) {
    if (row.source_key) this.byKey.set(row.source_key, row);
    const n = compactName(row.company_name);
    if (n && !this.byName.has(n)) this.byName.set(n, row);
    if (row.domain) this.byDomain.set(row.domain.toLowerCase(), row);
  }

  find(input: { sourceKey?: string | null; name?: string | null; domain?: string | null }): T | undefined {
    if (input.sourceKey && this.byKey.has(input.sourceKey)) return this.byKey.get(input.sourceKey);
    if (input.name) {
      const hit = this.byName.get(compactName(input.name));
      if (hit) return hit;
    }
    if (input.domain) return this.byDomain.get(input.domain.toLowerCase());
    return undefined;
  }

  findByDomainOtherThan(domain: string, id: string): T | undefined {
    const hit = this.byDomain.get(domain.toLowerCase());
    return hit && hit.id !== id ? hit : undefined;
  }

  setDomain(row: T, domain: string) {
    this.byDomain.set(domain.toLowerCase(), row);
  }
}
