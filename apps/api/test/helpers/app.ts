import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../../src/app.js';
import { parseEnv } from '../../src/config/env.js';
import { createPool } from '../../src/db/client.js';
import { requireTestDatabaseUrl } from './db.js';

export interface TestApp {
  app: FastifyInstance;
  pool: pg.Pool;
  close: () => Promise<void>;
}

// The real app against elevate_test. `poolSize` matters for concurrency tests: a small
// pool forces requests to queue and contend, as they would in production.
export async function createTestApp(poolSize = 5): Promise<TestApp> {
  const env = parseEnv({ DATABASE_URL: requireTestDatabaseUrl(), LOG_LEVEL: 'silent' });
  const pool = createPool(env.DATABASE_URL, { max: poolSize, onIdleClientError: () => {} });
  const app = buildApp({ env, pool });
  await app.ready();
  return {
    app,
    pool,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}
