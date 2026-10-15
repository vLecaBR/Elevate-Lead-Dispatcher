import pg from 'pg';

export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be set (see .env.example)');
  }
  return url;
}

export function createTestPool(max = 5): pg.Pool {
  return new pg.Pool({ connectionString: requireTestDatabaseUrl(), max });
}

// Explicit list: a new table must be added here on purpose. CASCADE handles FK order and
// RESTART IDENTITY makes call center ids start at 1 again in every test.
const tables = [
  'sessions',
  'lead_status_events',
  'distributions',
  'leads',
  'users',
  'call_centers',
  'affiliates',
  'funnels',
  'products',
];

export async function truncateAll(pool: pg.Pool): Promise<void> {
  // Table names are the constants above, never input, so building the statement is safe.
  await pool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
