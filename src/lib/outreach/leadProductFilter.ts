// Product filter for the admin leads list. Read-only visibility: this does NOT define sender lanes
// (see sender.ts laneOf/laneFilter), so adding an option here never makes a product sendable.

export const LEAD_PRODUCT_OPTIONS = [
  { key: '', label: 'All products' },
  { key: 'calldesk', label: 'Calldesk' },
  { key: 'kreativekoala', label: 'Kreative Koala' },
  { key: 'readaloud', label: 'ReadAloud' },
  { key: 'mcp', label: 'MCP' },
] as const;

interface ProductFilterable {
  eq(column: string, value: string): unknown;
  like(column: string, pattern: string): unknown;
  or(filters: string): unknown;
}

// Group keys mirror the existing conventions: 'calldesk' = the base product plus every calldesk:<vertical>,
// 'kreativekoala' = every kreativekoala:<app>, 'readaloud' = readaloud:<variant>. Anything else is an exact match,
// so an unknown value yields an empty list rather than an error. No value (or 'all') applies no filter.
// Generic over the query type (returned unchanged in type) so the Supabase builder's types are not re-instantiated.
export function applyLeadProductFilter<Q>(query: Q, product: string | null | undefined): Q {
  const p = (product ?? '').trim();
  if (!p || p === 'all') return query;
  const q = query as unknown as ProductFilterable;
  if (p === 'calldesk') return q.or('product.eq.calldesk,product.like.calldesk:%') as Q;
  if (p === 'kreativekoala') return q.like('product', 'kreativekoala%') as Q;
  if (p === 'readaloud') return q.like('product', 'readaloud:%') as Q;
  return q.eq('product', p) as Q;
}
