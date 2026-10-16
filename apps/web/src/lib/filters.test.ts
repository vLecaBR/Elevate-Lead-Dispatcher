import { describe, expect, it } from 'vitest';
import { filtersFromSearch, leadsApiPath, searchFromFilters, withFilter } from './filters';

describe('filters <-> URL', () => {
  it('keeps only whitelisted, non-empty parameters', () => {
    const search = new URLSearchParams(
      'status=sale&product=nutralean&lead=123&cursor=abc&utm=x&source=&from=2026-10-01',
    );

    expect(filtersFromSearch(search)).toEqual({
      status: 'sale',
      product: 'nutralean',
      from: '2026-10-01',
    });
  });

  it('round-trips in a stable order, whatever the input order', () => {
    const a = searchFromFilters({ status: 'sale', product: 'nutralean' }).toString();
    const b = searchFromFilters({ product: 'nutralean', status: 'sale' }).toString();

    expect(a).toBe(b);
    expect(filtersFromSearch(new URLSearchParams(a))).toEqual({
      status: 'sale',
      product: 'nutralean',
    });
  });
});

describe('withFilter', () => {
  it('sets and clears a value', () => {
    expect(withFilter({}, 'status', 'sale')).toEqual({ status: 'sale' });
    expect(withFilter({ status: 'sale' }, 'status', '')).toEqual({});
  });

  it('drops the funnel when the product changes (a funnel belongs to a product)', () => {
    expect(withFilter({ product: 'nutralean', funnel: 'vsl-02' }, 'product', 'glicofit')).toEqual({
      product: 'glicofit',
    });
  });
});

describe('leadsApiPath', () => {
  it('builds the API query with page size and cursor', () => {
    expect(leadsApiPath({ status: 'sale' }, 'CURSOR', 25)).toBe(
      '/api/leads?status=sale&limit=25&cursor=CURSOR',
    );
    expect(leadsApiPath({})).toBe('/api/leads?limit=25');
  });

  it('encodes values instead of concatenating them raw', () => {
    expect(leadsApiPath({ source: 'a&limit=1000' })).toBe(
      '/api/leads?source=a%26limit%3D1000&limit=25',
    );
  });
});
