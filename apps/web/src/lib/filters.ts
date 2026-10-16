// List filters live in the URL (shareable, survive reload, back button works). Pure
// functions: whitelist in, whitelist out, so nothing else from the address bar reaches the
// API query.

export const FILTER_KEYS = [
  'product',
  'funnel',
  'status',
  'call_center',
  'source',
  'from',
  'to',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Partial<Record<FilterKey, string>>;

export const PAGE_SIZE = 25;

export function filtersFromSearch(search: URLSearchParams): Filters {
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const value = search.get(key)?.trim();
    if (value) {
      filters[key] = value;
    }
  }
  return filters;
}

// Stable order (the whitelist order), so the same filters always give the same string and
// the same query cache key.
export function searchFromFilters(filters: Filters): URLSearchParams {
  const search = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) {
      search.set(key, value);
    }
  }
  return search;
}

export function withFilter(filters: Filters, key: FilterKey, value: string): Filters {
  const next: Filters = { ...filters, [key]: value || undefined };
  // A funnel belongs to a product: changing the product invalidates the funnel choice.
  if (key === 'product') {
    delete next.funnel;
  }
  return Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Filters;
}

export function leadsApiPath(filters: Filters, cursor?: string, limit = PAGE_SIZE): string {
  const search = searchFromFilters(filters);
  search.set('limit', String(limit));
  if (cursor) {
    search.set('cursor', cursor);
  }
  return `/api/leads?${search.toString()}`;
}
