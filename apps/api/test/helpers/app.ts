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

// Every inject() comes from the same IP, so the production per-IP limits would trip the
// concurrency tests. Tests get generous limits unless they test the limiter itself.
const NO_PRACTICAL_LIMIT = '1000000';

// The real app against elevate_test. `poolSize` matters for concurrency tests: a small
// pool forces requests to queue and contend, as they would in production.
export async function createTestApp(
  poolSize = 5,
  envOverrides: Record<string, string> = {},
): Promise<TestApp> {
  const env = parseEnv({
    DATABASE_URL: requireTestDatabaseUrl(),
    LOG_LEVEL: 'silent',
    RATE_LIMIT_GLOBAL_PER_MIN: NO_PRACTICAL_LIMIT,
    RATE_LIMIT_LEADS_PER_MIN: NO_PRACTICAL_LIMIT,
    RATE_LIMIT_WEBHOOK_PER_MIN: NO_PRACTICAL_LIMIT,
    RATE_LIMIT_LOGIN_PER_MIN: NO_PRACTICAL_LIMIT,
    ...envOverrides,
  });
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
