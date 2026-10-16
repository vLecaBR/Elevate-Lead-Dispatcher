import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from '../../../src/modules/leads/list-query.js';

describe('list cursor', () => {
  it('round-trips with full microsecond precision', () => {
    const cursor = {
      createdAt: '2026-10-15 12:00:00.123456+00',
      id: '01a142fb-6f24-7ef1-9a63-d877246b9caf',
    };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['not base64 json', 'abc'],
    ['wrong shape', Buffer.from('{"a":1}').toString('base64url')],
    ['bad id', Buffer.from('["2026-10-15 12:00:00+00","x"]').toString('base64url')],
    [
      'bad timestamp',
      Buffer.from('["yesterday","01a142fb-6f24-7ef1-9a63-d877246b9caf"]').toString('base64url'),
    ],
  ])('rejects %s', (_label, value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});

describe('list query schema', () => {
  it('applies the default page size and normalizes slugs', () => {
    expect(listQuerySchema.parse({ product: ' NutraLean ' })).toEqual({
      product: 'nutralean',
      limit: 25,
    });
  });

  it.each([
    ['unknown parameter', { stauts: 'sale' }],
    ['limit above 100', { limit: '101' }],
    ['limit 0', { limit: '0' }],
    ['unknown status', { status: 'won' }],
    ['bad date', { from: '15/10/2026' }],
    ['to before from', { from: '2026-10-15', to: '2026-10-14' }],
  ])('rejects %s', (_label, query) => {
    expect(listQuerySchema.safeParse(query).success).toBe(false);
  });

  it('coerces limit from the query string', () => {
    expect(listQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });
});
