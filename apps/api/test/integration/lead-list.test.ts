import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { ADMIN, loginAs, OPERATOR_A } from '../helpers/auth.js';
import { truncateAll } from '../helpers/db.js';
import { insertLead } from '../helpers/leads.js';

let t: TestApp;
let admin: string;

async function list(cookie: string, query = '') {
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/leads${query}`,
    headers: { cookie },
  });
  return response;
}

// Follows next_cursor until the end, returning every id in the order received.
async function listAll(cookie: string, query: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const separator = query ? '&' : '?';
    const page: { data: Array<{ id: string }>; next_cursor: string | null } = (
      await list(cookie, `${query}${cursor ? `${separator}cursor=${cursor}` : ''}`)
    ).json();
    ids.push(...page.data.map((lead) => lead.id));
    cursor = page.next_cursor;
  } while (cursor);
  return ids;
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
  admin = await loginAs(t.app, ADMIN);
});

describe('GET /api/leads: keyset pagination', () => {
  it('returns newest first with explicit fields and no internals', async () => {
    const older = await insertLead(t.pool, { createdAt: '2026-10-10 10:00:00-03' });
    const newer = await insertLead(t.pool, { createdAt: '2026-10-11 10:00:00-03', status: 'sale' });

    const response = await list(admin);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.map((l: { id: string }) => l.id)).toEqual([newer, older]);
    expect(body.data[0]).toEqual({
      id: newer,
      name: 'Lead',
      email: `${newer}@example.com`,
      phone: '+5511987654321',
      status: 'sale',
      source: 'facebook',
      product: 'nutralean',
      funnel: 'vsl-01',
      call_center: { slug: 'cc-a', name: 'Call Center A' },
      created_at: '2026-10-11T13:00:00.000Z',
      status_updated_at: expect.any(String),
    });
    expect(body.next_cursor).toBeNull();
    expect(response.body).not.toContain('dedupe');
  });

  it('walks every lead exactly once across pages, including ties and microsecond gaps', async () => {
    const created: string[] = [];
    // Same instant (tie broken by id) and instants that differ only in microseconds: a
    // millisecond-truncated cursor would skip or repeat these at a page boundary.
    for (const ts of [
      '2026-10-15 12:00:00.000001-03',
      '2026-10-15 12:00:00.000002-03',
      '2026-10-15 12:00:00.000002-03',
      '2026-10-15 12:00:00.000003-03',
      '2026-10-15 12:00:00.000003-03',
      '2026-10-15 12:00:00.000003-03',
      '2026-10-15 12:00:01-03',
    ]) {
      created.push(await insertLead(t.pool, { createdAt: ts }));
    }

    for (const limit of [1, 2, 3]) {
      const ids = await listAll(admin, `?limit=${limit}`);
      expect(ids).toHaveLength(created.length);
      expect(new Set(ids)).toEqual(new Set(created));
    }
  });

  it('rejects a tampered cursor, unknown parameters and a limit above 100', async () => {
    for (const query of ['?cursor=garbage', '?stauts=sale', '?limit=101']) {
      expect((await list(admin, query)).statusCode).toBe(422);
    }
  });
});

describe('GET /api/leads: filters', () => {
  beforeEach(async () => {
    await insertLead(t.pool, {
      createdAt: '2026-10-14 23:30:00-03',
      status: 'sale',
      source: 'google',
    });
    await insertLead(t.pool, { createdAt: '2026-10-15 00:10:00-03', callCenter: 'cc-b' });
    await insertLead(t.pool, {
      createdAt: '2026-10-15 23:50:00-03',
      product: 'glicofit',
      funnel: 'vsl-01',
      callCenter: 'cc-c',
    });
    await insertLead(t.pool, {
      createdAt: '2026-10-16 00:00:00-03',
      funnel: 'vsl-02',
      callCenter: null,
    });
  });

  async function count(query: string): Promise<number> {
    return (await listAll(admin, query)).length;
  }

  it.each([
    ['status', '?status=sale', 1],
    ['source', '?source=google', 1],
    ['product', '?product=glicofit', 1],
    ['funnel within a product', '?product=nutralean&funnel=vsl-02', 1],
    ['funnel slug across products', '?funnel=vsl-01', 3],
    ['call center', '?call_center=cc-b', 1],
    ['combined', '?product=nutralean&status=new&call_center=cc-b', 1],
    ['combined with no match', '?product=glicofit&status=sale', 0],
    ['unknown product', '?product=nope', 0],
  ])('filters by %s', async (_label, query, expected) => {
    expect(await count(query)).toBe(expected);
  });

  it('uses São Paulo day boundaries for from/to (inclusive)', async () => {
    // 2026-10-15 in São Paulo: 00:10 and 23:50. Not 23:30 of the 14th, not 00:00 of the 16th,
    // even though in UTC those fall on other days.
    expect(await count('?from=2026-10-15&to=2026-10-15')).toBe(2);
    expect(await count('?from=2026-10-15')).toBe(3);
    expect(await count('?to=2026-10-14')).toBe(1);
  });
});

describe('GET /api/leads: OPERATOR scope', () => {
  beforeEach(async () => {
    await insertLead(t.pool, { createdAt: '2026-10-15 10:00:00-03', callCenter: 'cc-a' });
    await insertLead(t.pool, { createdAt: '2026-10-15 11:00:00-03', callCenter: 'cc-b' });
    await insertLead(t.pool, { createdAt: '2026-10-15 12:00:00-03', callCenter: null });
  });

  it('lists only the leads of the operator call center', async () => {
    const operator = await loginAs(t.app, OPERATOR_A);

    const data = (await list(operator)).json().data;

    expect(data).toHaveLength(1);
    expect(data[0].call_center.slug).toBe('cc-a');
  });

  it('cannot widen the scope with the call_center filter', async () => {
    const operator = await loginAs(t.app, OPERATOR_A);

    expect((await list(operator, '?call_center=cc-b')).json().data).toEqual([]);
  });

  it('lets the ADMIN list every call center, pending included', async () => {
    expect((await list(admin)).json().data).toHaveLength(3);
  });
});
