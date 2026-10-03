// Minimal in-memory stand-in for the Supabase client: just the calls the pilot code makes.
type Row = Record<string, unknown>;
export interface FakeOpts { noFlagColumn?: boolean; noPilotsTable?: boolean }

export function makeFakeDb(seed: Record<string, Row[]>, opts: FakeOpts = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const writes: Array<{ table: string; op: string; row?: Row }> = [];
  let idSeq = 0;

  const db = {
    tables,
    writes,
    from(table: string) {
      const st = { eq: [] as Array<[string, unknown]>, inn: null as null | [string, unknown[]], gte: null as null | [string, string], mode: 'select' as 'select' | 'update' | 'delete', patch: null as Row | null, limit: 0, cols: '*' };
      const run = (single: 'none' | 'maybe' | 'one'): { data: unknown; error: unknown } => {
        if (opts.noPilotsTable && (table === 'calldesk_pilots' || table === 'calldesk_pilot_events')) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
        const rows = (tables[table] ||= []);
        let m = rows.filter((r) => st.eq.every(([c, v]) => r[c] === v));
        if (st.inn) m = m.filter((r) => st.inn![1].includes(r[st.inn![0]]));
        if (st.gte) m = m.filter((r) => String(r[st.gte![0]]) >= st.gte![1]);
        if (st.mode === 'update') {
          if (opts.noFlagColumn && st.patch && 'pilot_blocked' in st.patch) return { data: null, error: { code: '42703', message: 'column "pilot_blocked" does not exist' } };
          writes.push({ table, op: 'update', row: st.patch! });
          for (const r of m) Object.assign(r, st.patch);
        } else if (st.mode === 'delete') {
          writes.push({ table, op: 'delete' });
          tables[table] = rows.filter((r) => !m.includes(r));
          return { data: null, error: null };
        } else if (opts.noFlagColumn && table === 'calldesk_tenants' && st.cols.includes('pilot_blocked')) {
          return { data: null, error: { code: '42703', message: 'column calldesk_tenants.pilot_blocked does not exist' } };
        }
        if (st.limit) m = m.slice(0, st.limit);
        if (single === 'none') return { data: m.map((r) => ({ ...r })), error: null };
        if (single === 'one' && m.length !== 1) return { data: null, error: { message: 'no row' } };
        return { data: m[0] ? { ...m[0] } : null, error: null };
      };
      const b: Record<string, unknown> = {};
      b.select = (c?: string) => { if (c) st.cols = c; return b; };
      b.eq = (c: string, v: unknown) => { st.eq.push([c, v]); return b; };
      b.in = (c: string, v: unknown[]) => { st.inn = [c, v]; return b; };
      b.gte = (c: string, v: string) => { st.gte = [c, v]; return b; };
      b.order = () => b;
      b.limit = (n: number) => { st.limit = n; return b; };
      b.maybeSingle = () => Promise.resolve(run('maybe'));
      b.single = () => Promise.resolve(run('one'));
      b.update = (p: Row) => { st.mode = 'update'; st.patch = p; return b; };
      b.delete = () => { st.mode = 'delete'; return b; };
      b.insert = (row: Row) => {
        const out = (): { data: unknown; error: unknown } => {
          if (opts.noPilotsTable && (table === 'calldesk_pilots' || table === 'calldesk_pilot_events')) return { data: null, error: { code: '42P01', message: 'does not exist' } };
          const rows = (tables[table] ||= []);
          const uniq = table === 'calldesk_pilot_events' ? 'event_key' : table === 'calldesk_pilots' ? 'tenant_id' : null;
          if (uniq && rows.some((r) => r[uniq] === row[uniq])) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          const full = { id: `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`, ...row };
          rows.push(full);
          writes.push({ table, op: 'insert', row: full });
          return { data: { ...full }, error: null };
        };
        const ib: Record<string, unknown> = {};
        ib.select = () => ib;
        ib.single = () => Promise.resolve(out());
        ib.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(out()).then(res, rej);
        return ib;
      };
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run('none')).then(res, rej);
      return b;
    },
  };
  return db;
}
