import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { truncateAll } from '../helpers/db.js';

const CONCURRENT_REQUESTS = 50;
// Fewer connections than requests: transactions really overlap and queue, so the UNIQUE
// constraint (not luck in timing) has to be what prevents duplicates.
const POOL_SIZE = 10;

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp(POOL_SIZE);
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
});
afterAll(() => t.close());

describe('intake idempotency under concurrency', () => {
  it('creates exactly one lead from identical simultaneous requests', async () => {
    const lead = {
      name: 'Ana Souza',
      email: 'ana@example.com',
      phone: '+5511987654321',
      product: 'nutralean',
      funnel: 'vsl-01',
      source: 'facebook',
    };

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        t.app.inject({ method: 'POST', url: '/api/leads', payload: lead }),
      ),
    );

    // Assert on counts and final state, never on which request "won".
    const statuses = responses.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(CONCURRENT_REQUESTS - 1);
    expect(new Set(responses.map((r) => r.json().lead_id)).size).toBe(1);

    const { rows } = await t.pool.query<{ leads: number; events: number }>(
      `SELECT (SELECT count(*) FROM leads)::int AS leads,
              (SELECT count(*) FROM lead_status_events)::int AS events`,
    );
    expect(rows[0]).toEqual({ leads: 1, events: 1 });
  });
});
