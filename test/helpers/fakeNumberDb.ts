// Tiny in-memory Supabase stand-in for the number add-on tests: select/eq/neq/in/is/not/lt/gte, insert/update/delete, single/maybeSingle.
type Row = Record<string, unknown>;

export function makeNumberDb(seed: Record<string, Row[]>, opts: { failInsertOn?: string } = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  let seq = 1;
  return {
    tables,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
      let patch: Row = {};
      let inserted: Row[] = [];
      let limitN: number | null = null;
      let upsertKey = '';
      const run = (single: boolean) => {
        const rows = (tables[table] ??= []);
        if (mode === 'insert') {
          if (opts.failInsertOn === table) return { data: null, error: { message: 'insert failed' } };
          for (const r of inserted) rows.push({ id: `row-${seq++}`, source: 'purchased', addon_billed: false, ...r });
          return { data: single ? rows[rows.length - 1] : inserted, error: null };
        }
        if (mode === 'upsert') {
          let last: Row | undefined;
          for (const r of inserted) {
            const existing = rows.find((x) => x[upsertKey] === r[upsertKey]);
            if (existing) { Object.assign(existing, r); last = existing; } else { last = { id: `row-${seq++}`, ...r }; rows.push(last); }
          }
          return { data: single ? last ?? null : inserted, error: null };
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === 'update') { for (const r of matched) Object.assign(r, patch); return { data: matched, error: null }; }
        if (mode === 'delete') { tables[table] = rows.filter((r) => !matched.includes(r)); return { data: matched, error: null }; }
        const out = limitN === null ? matched : matched.slice(0, limitN);
        return { data: single ? out[0] ?? null : out, error: null };
      };
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.limit = (n: number) => { limitN = n; return b; };
      b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
      b.neq = (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; };
      b.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; };
      b.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; };
      b.not = (c: string, _op: string, v: unknown) => { filters.push((r) => (r[c] ?? null) !== v); return b; };
      b.lt = (c: string, v: string) => { filters.push((r) => r[c] != null && String(r[c]) < v); return b; };
      b.gte = (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; };
      b.insert = (row: Row | Row[]) => { mode = 'insert'; inserted = Array.isArray(row) ? row : [row]; return b; };
      b.upsert = (row: Row | Row[], o: { onConflict?: string } = {}) => { mode = 'upsert'; upsertKey = o.onConflict ?? 'id'; inserted = Array.isArray(row) ? row : [row]; return b; };
      b.update = (p: Row) => { mode = 'update'; patch = p; return b; };
      b.delete = () => { mode = 'delete'; return b; };
      b.single = async () => run(true);
      b.maybeSingle = async () => run(true);
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej);
      return b;
    },
  };
}

/** A fake Stripe subscription with items, recording every item call. */
export function makeFakeStripe(items: Array<{ id: string; price: { id: string }; quantity?: number }>, opts: { failCreate?: boolean } = {}) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  let n = 1;
  const state = { items: items.map((i) => ({ ...i })) };
  const stripe = {
    subscriptions: { retrieve: async () => ({ id: 'sub_1', status: 'active', items: { data: state.items } }) },
    subscriptionItems: {
      create: async (args: { price: string; quantity?: number }) => {
        calls.push({ op: 'create', args: [args] });
        if (opts.failCreate) throw new Error('stripe down');
        const item = { id: `si_new${n++}`, price: { id: args.price }, quantity: args.quantity };
        state.items.push(item);
        return item;
      },
      update: async (id: string, args: { quantity?: number }) => {
        calls.push({ op: 'update', args: [id, args] });
        const it = state.items.find((i) => i.id === id);
        if (it && args.quantity !== undefined) it.quantity = args.quantity;
        return it;
      },
      del: async (id: string, args: unknown) => {
        calls.push({ op: 'del', args: [id, args] });
        state.items = state.items.filter((i) => i.id !== id);
        return { id, deleted: true };
      },
    },
  };
  return { stripe, calls, state };
}
