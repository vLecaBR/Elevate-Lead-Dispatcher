import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseEnv } from '../config/env.js';

// DEVELOPMENT ONLY. Inserts N synthetic leads (default 100k) with distributions and status
// history, so EXPLAIN shows the plans the indexes give at a realistic size. Set-based SQL
// (generate_series): one statement per table instead of N round trips.
// Requires the demo seed (products, funnels, call centers). Safe to run more than once:
// every run uses its own dedupe keys.

const STEPS = [
  // 1. One row per synthetic lead, with everything decided up front.
  `CREATE TEMP TABLE bulk ON COMMIT DROP AS
   WITH funnel_pick AS (
     SELECT row_number() OVER (ORDER BY f.id) AS n, f.id AS funnel_id, f.product_id
     FROM funnels f
   ),
   cc AS (SELECT slug, id FROM call_centers),
   base AS (
     SELECT g,
            now() - random() * interval '90 days' AS ts,
            md5(random()::text || g::text) AS h,
            random() AS r_cc,
            random() AS r_status
     FROM generate_series(1, $1::int) AS g
   )
   SELECT g, ts,
          -- UUIDv7 built in SQL from created_at (48-bit ms timestamp, version 7, variant 8),
          -- so bulk rows keep the same index locality as rows from the application.
          (lpad(to_hex((extract(epoch FROM ts) * 1000)::bigint), 12, '0')
             || '7' || substr(h, 1, 3) || '8' || substr(h, 4, 15))::uuid AS id,
          fp.funnel_id, fp.product_id,
          (ARRAY['facebook', 'google', 'tiktok', 'email', 'organic'])[1 + g % 5] AS source,
          CASE WHEN r_cc < 0.03 THEN NULL                               -- ~3% pending
               WHEN r_cc < 0.03 + 0.97 * 0.5 THEN (SELECT id FROM cc WHERE slug = 'cc-a')
               WHEN r_cc < 0.03 + 0.97 * 0.8 THEN (SELECT id FROM cc WHERE slug = 'cc-b')
               ELSE (SELECT id FROM cc WHERE slug = 'cc-c') END AS call_center_id,
          r_status
   FROM base
   JOIN funnel_pick fp ON fp.n = 1 + g % (SELECT count(*) FROM funnel_pick)`,

  // Pending leads stay `new`; the others get a plausible current status.
  `ALTER TABLE bulk ADD COLUMN status lead_status`,
  `UPDATE bulk SET status = CASE
     WHEN call_center_id IS NULL THEN 'new'
     WHEN r_status < 0.30 THEN 'new'
     WHEN r_status < 0.50 THEN 'contacted'
     WHEN r_status < 0.65 THEN 'no_answer'
     WHEN r_status < 0.75 THEN 'callback'
     WHEN r_status < 0.83 THEN 'qualified'
     WHEN r_status < 0.93 THEN 'sale'
     WHEN r_status < 0.95 THEN 'refund'
     ELSE 'invalid' END::lead_status`,

  `INSERT INTO leads (id, name, email, phone_e164, product_id, funnel_id, source, status,
                      status_updated_at, call_center_id, distributed_at, dedupe_key,
                      request_hash, created_at, updated_at)
   SELECT id, 'Bulk Lead ' || g, 'bulk' || g || '-' || $1::text || '@example.com',
          '+55119' || lpad((g % 100000000)::text, 8, '0'), product_id, funnel_id, source, status,
          ts, call_center_id, CASE WHEN call_center_id IS NULL THEN NULL ELSE ts END,
          'bulk:' || $1::text || ':' || g, 'bulk', ts, ts
   FROM bulk`,

  // Distribution rows mirror leads.call_center_id, like the dispatcher writes them.
  `INSERT INTO distributions (lead_id, call_center_id, strategy, weights_snapshot, distributed_at)
   SELECT id, call_center_id, 'bulk', '[]'::jsonb, ts FROM bulk WHERE call_center_id IS NOT NULL`,

  `INSERT INTO lead_status_events (lead_id, status, event_ts, received_at, source, event_key)
   SELECT id, 'new', ts, ts, 'system', 'system:new' FROM bulk`,

  `INSERT INTO lead_status_events (lead_id, status, event_ts, received_at, source,
                                   call_center_id, event_key)
   SELECT id, status, ts + interval '1 hour', ts + interval '1 hour', 'webhook',
          call_center_id, 'bulk:' || status::text
   FROM bulk WHERE status <> 'new'`,
];

export async function seedBulk(pool: pg.Pool, count: number): Promise<void> {
  const runId = randomUUID().slice(0, 8);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The first step takes the count, the insert into leads takes the run id; both are
    // bound parameters ($1), never interpolated into the SQL.
    await client.query(STEPS[0]!, [count]);
    for (const step of STEPS.slice(1)) {
      const params = step.includes('$1') ? [runId] : [];
      await client.query(step, params);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  // Fresh statistics, so the planner sees the real table sizes in EXPLAIN.
  await pool.query('ANALYZE leads, distributions, lead_status_events');
}

if (import.meta.main) {
  const env = parseEnv(process.env);
  if (!env.SEED_DEMO) {
    console.error('Refusing to seed: set SEED_DEMO=true (development only).');
    process.exit(1);
  }
  const count = Number(process.argv[2] ?? 100_000);
  if (!Number.isInteger(count) || count < 1) {
    console.error('Usage: npm run db:seed-bulk -- <number of leads>');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const t0 = performance.now();
  try {
    await seedBulk(pool, count);
    console.log(
      `${count} bulk leads inserted in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    );
  } finally {
    await pool.end();
  }
}
