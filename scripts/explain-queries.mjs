// Runs EXPLAIN (ANALYZE, BUFFERS) on the main read queries, to check which index each one
// uses (PLAN.md §5). Run after `npm run db:seed-bulk` so the tables have a realistic size.
//
//   npm run db:explain
//
// The SQL mirrors what the repositories generate (WHERE / ORDER BY / LIMIT are what decide
// the plan): apps/api/src/modules/leads/scoped-repository.ts (listLeads),
// dispatcher/repository.ts (lockPendingLeadIds, summarizeCallCenters) and
// dashboard/repository.ts (countLeads). Env: DATABASE_URL, APP_TIMEZONE.
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const timeZone = process.env.APP_TIMEZONE ?? 'America/Sao_Paulo';
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const LIST_SELECT = `
  SELECT l.id, l.name, l.email, l.phone_e164, l.status, l.source, p.slug, f.slug, c.slug, c.name,
         l.created_at, l.created_at::text, l.status_updated_at
  FROM leads l
  JOIN products p ON p.id = l.product_id
  JOIN funnels f ON f.id = l.funnel_id
  LEFT JOIN call_centers c ON c.id = l.call_center_id`;
const LIST_ORDER = 'ORDER BY l.created_at DESC, l.id DESC LIMIT 26';

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const { rows: sizes } = await client.query(
    `SELECT (SELECT count(*) FROM leads)::int AS leads,
            (SELECT count(*) FROM distributions)::int AS distributions,
            (SELECT count(*) FROM lead_status_events)::int AS events`,
  );
  console.log('table sizes:', sizes[0]);

  // A real cursor: the 26th row of the ADMIN list, as the API would encode it.
  const { rows: cursorRows } = await client.query(
    `SELECT created_at::text AS created_at, id FROM leads
     ORDER BY created_at DESC, id DESC OFFSET 25 LIMIT 1`,
  );
  const cursor = cursorRows[0];

  const queries = [
    ['ADMIN list, first page', `${LIST_SELECT} ${LIST_ORDER}`, []],
    [
      'OPERATOR list (call center 1)',
      `${LIST_SELECT} WHERE l.call_center_id = $1 ${LIST_ORDER}`,
      [1],
    ],
    ['status filter (sale)', `${LIST_SELECT} WHERE l.status = $1 ${LIST_ORDER}`, ['sale']],
    [
      'product + funnel filter',
      `${LIST_SELECT}
       WHERE l.product_id = (SELECT id FROM products WHERE slug = $1)
         AND l.funnel_id = (SELECT f2.id FROM funnels f2 JOIN products p2 ON p2.id = f2.product_id
                            WHERE f2.slug = $2 AND p2.slug = $1)
       ${LIST_ORDER}`,
      ['nutralean', 'vsl-01'],
    ],
    ['source filter (google)', `${LIST_SELECT} WHERE l.source = $1 ${LIST_ORDER}`, ['google']],
    [
      'period filter (last 7 days, business timezone)',
      `${LIST_SELECT}
       WHERE l.created_at >= ((now() AT TIME ZONE $1)::date - 6)::timestamp AT TIME ZONE $1
       ${LIST_ORDER}`,
      [timeZone],
    ],
    [
      'next page by cursor (keyset)',
      `${LIST_SELECT}
       WHERE (l.created_at, l.id) < ($1::timestamptz, $2::uuid)
       ${LIST_ORDER}`,
      [cursor?.created_at, cursor?.id],
    ],
    [
      'pending queue (redispatch)',
      'SELECT id FROM leads WHERE call_center_id IS NULL ORDER BY id LIMIT 100',
      [],
    ],
    [
      'dashboard metrics',
      `SELECT count(*),
              count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1),
              count(*) FILTER (WHERE call_center_id IS NOT NULL),
              count(*) FILTER (WHERE call_center_id IS NULL),
              count(*) FILTER (WHERE status = 'sale')
       FROM leads`,
      [timeZone],
    ],
    [
      'dispatcher summary',
      `SELECT c.id, c.slug, count(d.id) FROM call_centers c
       LEFT JOIN distributions d ON d.call_center_id = c.id
       GROUP BY c.id ORDER BY c.id`,
      [],
    ],
  ];

  for (const [title, sql, params] of queries) {
    const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${sql}`, params);
    console.log(`\n=== ${title}`);
    console.log(rows.map((row) => row['QUERY PLAN']).join('\n'));
  }
} finally {
  await client.end();
}
