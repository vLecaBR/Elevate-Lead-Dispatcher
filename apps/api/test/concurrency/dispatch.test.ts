import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { truncateAll } from '../helpers/db.js';

const REQUESTS = 100;
// Far fewer connections than requests: transactions overlap and queue on the dispatcher
// lock for real. Without FOR UPDATE, two of them would read the same credits and the
// final split would drift from 50/30/20.
const POOL_SIZE = 20;

let t: TestApp;

const baseLead = {
  name: 'Lead Test',
  phone: '+5511987654321',
  product: 'nutralean',
  funnel: 'vsl-01',
  source: 'load-test',
};

function postLead(body: object) {
  return t.app.inject({ method: 'POST', url: '/api/leads', payload: body });
}

beforeAll(async () => {
  t = await createTestApp(POOL_SIZE);
});
afterAll(() => t.close());
beforeEach(async () => {
  await truncateAll(t.pool);
  await seedDemo(createDb(t.pool));
});

describe('dispatcher under concurrency', () => {
  it('splits 100 simultaneous distinct leads exactly 50/30/20', async () => {
    const responses = await Promise.all(
      Array.from({ length: REQUESTS }, (_, i) =>
        postLead({ ...baseLead, email: `lead${i}@example.com` }),
      ),
    );

    // Assertions on counts and final state only, never on response order.
    expect(responses.map((r) => r.statusCode)).toEqual(Array(REQUESTS).fill(201));
    expect(new Set(responses.map((r) => r.json().lead_id)).size).toBe(REQUESTS);

    const { rows: split } = await t.pool.query<{ slug: string; leads: number }>(
      `SELECT c.slug, count(d.id)::int AS leads
       FROM call_centers c LEFT JOIN distributions d ON d.call_center_id = c.id
       GROUP BY c.slug ORDER BY c.slug`,
    );
    expect(split).toEqual([
      { slug: 'cc-a', leads: 50 },
      { slug: 'cc-b', leads: 30 },
      { slug: 'cc-c', leads: 20 },
    ]);

    // 100 is a multiple of sum(weights)/gcd = 10, so SWRR state is back where it started.
    const { rows: credits } = await t.pool.query<{ credit: string }>(
      `SELECT dispatch_credit AS credit FROM call_centers ORDER BY id`,
    );
    expect(credits.map((c) => Number(c.credit))).toEqual([0, 0, 0]);

    const { rows: consistency } = await t.pool.query<{ pending: number; mismatched: number }>(
      `SELECT count(*) FILTER (WHERE l.call_center_id IS NULL)::int AS pending,
              count(*) FILTER (WHERE d.call_center_id IS DISTINCT FROM l.call_center_id)::int AS mismatched
       FROM leads l LEFT JOIN distributions d ON d.lead_id = l.id`,
    );
    expect(consistency[0]).toEqual({ pending: 0, mismatched: 0 });
  });

  it('creates and dispatches exactly one lead from 100 identical simultaneous requests', async () => {
    const lead = { ...baseLead, email: 'same@example.com' };

    const responses = await Promise.all(Array.from({ length: REQUESTS }, () => postLead(lead)));

    const statuses = responses.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(REQUESTS - 1);
    expect(new Set(responses.map((r) => r.json().lead_id)).size).toBe(1);

    const { rows } = await t.pool.query<{ leads: number; distributions: number }>(
      `SELECT (SELECT count(*) FROM leads)::int AS leads,
              (SELECT count(*) FROM distributions)::int AS distributions`,
    );
    expect(rows[0]).toEqual({ leads: 1, distributions: 1 });
  });
});
