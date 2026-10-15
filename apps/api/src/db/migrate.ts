import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { parseEnv } from '../config/env.js';
import { createDb } from './client.js';

// Next to this file both in src/ (tsx) and in dist/ (the Docker image copies the SQL there).
const migrationsFolder = path.resolve(import.meta.dirname, 'migrations');

export async function runMigrations(databaseUrl: string): Promise<void> {
  // Single dedicated connection: migrations run once, before the API starts.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(createDb(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

// Run only as a script (npm run db:migrate, compose migrate service), not when imported by tests.
if (import.meta.main) {
  const env = parseEnv(process.env);
  await runMigrations(env.DATABASE_URL);
  console.log('migrations applied');
}
