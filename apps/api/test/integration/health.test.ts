import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { parseEnv } from '../../src/config/env.js';
import { createPool } from '../../src/db/client.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL must be set (see .env.example)');
}

// Port 1 is never a Postgres server, so the ping fails fast with ECONNREFUSED.
const unreachableDatabaseUrl = 'postgres://nobody:nobody@127.0.0.1:1/none';

let app: FastifyInstance | undefined;
let pool: pg.Pool | undefined;
let idleClientErrors: Error[] = [];

function setup(databaseUrl: string): FastifyInstance {
  const env = parseEnv({ DATABASE_URL: databaseUrl, LOG_LEVEL: 'silent' });
  idleClientErrors = [];
  pool = createPool(env.DATABASE_URL, {
    max: 1,
    onIdleClientError: (error) => idleClientErrors.push(error),
  });
  app = buildApp({ env, pool });
  return app;
}

afterEach(async () => {
  await app?.close();
  await pool?.end();
  app = undefined;
  pool = undefined;
});

describe('health endpoints', () => {
  it('GET /health answers without touching the database', async () => {
    const response = await setup(unreachableDatabaseUrl).inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready is 200 when the database answers', async () => {
    const response = await setup(testDatabaseUrl).inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  // Regression: the server dropping an idle pooled connection used to crash the process
  // (unhandled 'error' event on the pool) when the db container was stopped.
  it('keeps serving /ready after the database drops an idle connection', async () => {
    const server = setup(testDatabaseUrl);
    expect((await server.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);

    const { rows } = await pool!.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const idlePid = rows[0]!.pid;
    const admin = new pg.Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    try {
      await admin.query('SELECT pg_terminate_backend($1)', [idlePid]);
    } finally {
      await admin.end();
    }
    await expect.poll(() => idleClientErrors.length).toBe(1);

    const response = await server.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
  });

  it('GET /ready is 503 when the database is unreachable', async () => {
    const response = await setup(unreachableDatabaseUrl).inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
  });
});
