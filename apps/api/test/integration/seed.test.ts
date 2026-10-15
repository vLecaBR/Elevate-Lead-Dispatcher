import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { seedDemo } from '../../src/db/seed.js';
import { createTestPool, truncateAll } from '../helpers/db.js';

const pool = createTestPool();
const db = createDb(pool);

async function countRows(): Promise<Record<string, number>> {
  const { rows } = await pool.query<Record<string, number>>(
    `SELECT
       (SELECT count(*) FROM products)::int AS products,
       (SELECT count(*) FROM funnels)::int AS funnels,
       (SELECT count(*) FROM call_centers)::int AS call_centers,
       (SELECT count(*) FROM users)::int AS users`,
  );
  return rows[0]!;
}

beforeAll(async () => {
  await truncateAll(pool);
  await seedDemo(db);
});
afterAll(() => pool.end());

describe('seedDemo', () => {
  it('creates the demo data and is idempotent', async () => {
    const afterFirstRun = await countRows();
    await seedDemo(db);

    expect(afterFirstRun).toEqual({ products: 3, funnels: 5, call_centers: 3, users: 4 });
    expect(await countRows()).toEqual(afterFirstRun);
  });

  it('creates call centers in id order A, B, C with weights 50/30/20', async () => {
    const { rows } = await pool.query('SELECT id, slug, weight FROM call_centers ORDER BY id');

    expect(rows).toEqual([
      { id: 1, slug: 'cc-a', weight: 50 },
      { id: 2, slug: 'cc-b', weight: 30 },
      { id: 3, slug: 'cc-c', weight: 20 },
    ]);
  });

  it('stores Argon2id hashes, never the password, and binds each operator to one call center', async () => {
    const { rows } = await pool.query<{
      email: string;
      role: string;
      slug: string | null;
      password_hash: string;
    }>(
      `SELECT u.email, u.role, c.slug, u.password_hash
       FROM users u LEFT JOIN call_centers c ON c.id = u.call_center_id
       ORDER BY u.email`,
    );

    for (const row of rows) {
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
    }
    expect(rows.map(({ email, role, slug }) => ({ email, role, slug }))).toEqual([
      { email: 'admin@elevate.local', role: 'ADMIN', slug: null },
      { email: 'operator.a@elevate.local', role: 'OPERATOR', slug: 'cc-a' },
      { email: 'operator.b@elevate.local', role: 'OPERATOR', slug: 'cc-b' },
      { email: 'operator.c@elevate.local', role: 'OPERATOR', slug: 'cc-c' },
    ]);
  });
});
