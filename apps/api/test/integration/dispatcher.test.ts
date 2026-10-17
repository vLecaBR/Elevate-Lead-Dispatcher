import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { dispatchLead, redispatchPending } from '../../src/modules/dispatcher/service.js';
import { AppError } from '../../src/shared/errors.js';
import { uuidv7 } from '../../src/shared/uuid.js';
import { createTestPool, truncateAll } from '../helpers/db.js';

const pool = createTestPool();
const db = createDb(pool);
const config = { lockTimeoutMs: 200 };

afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(pool);
  await seedDemo(db);
});

// Pending leads as the intake leaves them when no call center is eligible.
async function insertPendingLeads(n: number): Promise<string[]> {
  const { rows } = await pool.query<{ product_id: string; funnel_id: string }>(
    `SELECT p.id AS product_id, f.id AS funnel_id
     FROM products p JOIN funnels f ON f.product_id = p.id
     WHERE p.slug = 'nutralean' AND f.slug = 'vsl-01'`,
  );
  const { product_id, funnel_id } = rows[0]!;
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = uuidv7();
    await pool.query(
      `INSERT INTO leads (id, name, email, phone_e164, product_id, funnel_id, source, dedupe_key, request_hash)
       VALUES ($1, 'Lead', $2, '+5511987654321', $3, $4, 'test', $2, 'hash')`,
      [id, `lead${i}@example.com`, product_id, funnel_id],
    );
    ids.push(id);
    // Distinct milliseconds, so UUIDv7 order is creation order without relying on luck.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return ids;
}

async function assignmentsInCreationOrder(): Promise<string[]> {
  const { rows } = await pool.query<{ slug: string | null }>(
    `SELECT c.slug FROM leads l LEFT JOIN call_centers c ON c.id = l.call_center_id ORDER BY l.id`,
  );
  return rows.map((r) => r.slug ?? 'pending');
}

describe('redispatchPending', () => {
  it('distributes pending leads in creation order following SWRR', async () => {
    await insertPendingLeads(10);

    const result = await redispatchPending(db, config);

    expect(result).toEqual({ distributed: 10, remaining: 0 });
    expect((await assignmentsInCreationOrder()).join(',')).toBe(
      'cc-a,cc-b,cc-c,cc-a,cc-a,cc-b,cc-a,cc-c,cc-b,cc-a',
    );
  });

  it('works across several batches', async () => {
    await insertPendingLeads(10);

    expect(await redispatchPending(db, config, 3)).toEqual({ distributed: 10, remaining: 0 });
  });

  it('records the distribution and mirrors it on the lead', async () => {
    await insertPendingLeads(3);

    await redispatchPending(db, config);

    const { rows } = await pool.query<{ mismatches: number; distributions: number }>(
      // Timestamps compared to the microsecond: the mirror must be exact, not ms-truncated.
      `SELECT count(*) FILTER (WHERE d.call_center_id IS DISTINCT FROM l.call_center_id
                                  OR d.distributed_at IS DISTINCT FROM l.distributed_at)::int AS mismatches,
              count(d.id)::int AS distributions
       FROM leads l LEFT JOIN distributions d ON d.lead_id = l.id`,
    );
    expect(rows[0]).toEqual({ mismatches: 0, distributions: 3 });
  });

  it('leaves leads pending when no call center is eligible', async () => {
    await pool.query(`UPDATE call_centers SET is_active = false`);
    await insertPendingLeads(4);

    expect(await redispatchPending(db, config)).toEqual({ distributed: 0, remaining: 4 });
  });

  it('skips inactive and weight-0 call centers', async () => {
    await pool.query(`UPDATE call_centers SET is_active = false WHERE slug = 'cc-a'`);
    await pool.query(`UPDATE call_centers SET weight = 0 WHERE slug = 'cc-b'`);
    await insertPendingLeads(5);

    await redispatchPending(db, config);

    expect(new Set(await assignmentsInCreationOrder())).toEqual(new Set(['cc-c']));
  });
});

describe('dispatchLead under lock contention', () => {
  it('fails fast with 503 and Retry-After when the lock is held too long', async () => {
    const [leadId] = await insertPendingLeads(1);
    const holder = await pool.connect();
    try {
      // Another transaction holds the dispatcher lock and does not commit.
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM call_centers ORDER BY id FOR UPDATE');

      const attempt = db.transaction((tx) => dispatchLead(tx, leadId!, config));

      await expect(attempt).rejects.toSatisfy(
        (error) =>
          error instanceof AppError &&
          error.statusCode === 503 &&
          error.code === 'dispatch_busy' &&
          error.headers?.['retry-after'] === '1',
      );
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    // Nothing was half-written by the failed attempt.
    expect(await assignmentsInCreationOrder()).toEqual(['pending']);
  });

  // Regression (independent review, B1): statement_timeout (57014) was not mapped and
  // surfaced as a 500 instead of the overload answer.
  it('also answers 503 when statement_timeout expires first', async () => {
    const [leadId] = await insertPendingLeads(1);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM call_centers ORDER BY id FOR UPDATE');

      const attempt = db.transaction((tx) =>
        dispatchLead(tx, leadId!, { lockTimeoutMs: 10_000, statementTimeoutMs: 200 }),
      );

      await expect(attempt).rejects.toSatisfy(
        (error) =>
          error instanceof AppError && error.statusCode === 503 && error.code === 'dispatch_busy',
      );
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });
});

describe('redispatchPending under concurrency', () => {
  // The comment in the repository claims SKIP LOCKED lets parallel runs split the work;
  // this checks it: no lead dispatched twice, none left behind.
  it('two simultaneous runs distribute every pending lead exactly once', async () => {
    await insertPendingLeads(40);

    const results = await Promise.all([
      redispatchPending(db, config, 5),
      redispatchPending(db, config, 5),
    ]);

    expect(results[0]!.distributed + results[1]!.distributed).toBe(40);
    const { rows } = await pool.query<{ distributions: number; pending: number }>(
      `SELECT (SELECT count(*) FROM distributions)::int AS distributions,
              (SELECT count(*) FROM leads WHERE call_center_id IS NULL)::int AS pending`,
    );
    expect(rows[0]).toEqual({ distributions: 40, pending: 0 });
  });
});
