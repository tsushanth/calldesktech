// Minimal in-memory stand-in for the Supabase query builder, enough for the outreach pipeline stages.
// Filters: eq neq in is lt lte gt gte not(col,'is',null); order; range; limit; count/head; insert/update.
// Inserting into a *_messages table enforces the (lead_id, step) uniqueness of migration 034.
type Row = Record<string, unknown>;
export interface FakeDb { from(t: string): unknown; tables: Record<string, Row[]>; inserts: { table: string; row: Row }[]; updates: { table: string; patch: Row }[] }

export function makeDb(initial: Record<string, Row[]>): FakeDb {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const inserts: FakeDb['inserts'] = [];
  const updates: FakeDb['updates'] = [];
  let seq = 1000;
  const db = {
    tables, inserts, updates,
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const orders: { col: string; asc: boolean }[] = [];
      let from = 0; let to = Infinity; let head = false; let count = false; let mode: 'select' | 'insert' | 'update' = 'select'; let patch: Row = {}; let single = false;
      let insertRows: Row[] = [];
      const cmp = (a: unknown, b: unknown) => (a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);
      const run = () => {
        const all = (tables[table] ??= []);
        if (mode === 'insert') {
          for (const r of insertRows) {
            if (table.endsWith('_messages') && r.status !== 'rejected' && all.some((x) => x.lead_id === r.lead_id && (x.step ?? 1) === (r.step ?? 1) && x.status !== 'rejected')) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          for (const r of insertRows) { const row = { id: `gen-${seq++}`, ...r }; all.push(row); inserts.push({ table, row }); }
          return { data: single ? all[all.length - 1] : insertRows, error: null };
        }
        const matched = all.filter((r) => filters.every((f) => f(r)));
        if (mode === 'update') { for (const r of matched) { Object.assign(r, patch); } updates.push({ table, patch }); return { data: matched, error: null }; }
        let rows = [...matched];
        for (const o of [...orders].reverse()) rows.sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]));
        rows = rows.slice(from, to === Infinity ? undefined : to + 1);
        if (head) return { data: null, count: matched.length, error: null };
        return { data: single ? rows[0] ?? null : rows, ...(count ? { count: matched.length } : {}), error: null };
      };
      const q: Record<string, unknown> = {
        select: (_c?: string, o?: { count?: string; head?: boolean }) => { head = !!o?.head; count = !!o?.count; return q; },
        insert: (r: Row | Row[]) => { mode = 'insert'; insertRows = Array.isArray(r) ? r : [r]; return q; },
        update: (p: Row) => { mode = 'update'; patch = p; return q; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
        is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
        not: (c: string, op: string, v: unknown) => { filters.push((r) => (op === 'is' && v === null ? r[c] != null : true)); return q; },
        lt: (c: string, v: never) => { filters.push((r) => r[c] != null && (r[c] as never) < v); return q; },
        lte: (c: string, v: never) => { filters.push((r) => r[c] != null && (r[c] as never) <= v); return q; },
        gt: (c: string, v: never) => { filters.push((r) => r[c] != null && (r[c] as never) > v); return q; },
        gte: (c: string, v: never) => { filters.push((r) => r[c] != null && (r[c] as never) >= v); return q; },
        or: () => q,
        order: (col: string, o?: { ascending?: boolean }) => { orders.push({ col, asc: o?.ascending !== false }); return q; },
        range: (a: number, b: number) => { from = a; to = b; return q; },
        limit: (n: number) => { to = from + n - 1; return q; },
        single: () => { single = true; return q; },
        maybeSingle: () => { single = true; return q; },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  };
  return db as unknown as FakeDb;
}
